import "server-only";

import type { Pool } from "mysql2/promise";

import {
  LifecycleDependencyConflictError,
  type LifecycleCommandInput,
  lifecycleCommandInputSchema,
  LifecycleStateConflictError,
} from "@/features/lifecycle";
import {
  findProjectForUpdate,
  type Project,
  projectHasLifecycleDependencies,
  updateProjectRecord,
} from "@/features/projects/repository";
import {
  ProjectNotFoundError,
  ProjectVersionConflictError,
} from "@/features/projects/service";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export type ProjectLifecycleContext = Readonly<{
  actorId: string;
  correlationId: string;
  now?: Date;
}>;

function summary(project: Project) {
  return {
    archivedAtUtc: project.archivedAtUtc,
    archivedByUserAccountId: project.archivedByUserAccountId,
    status: project.status,
    version: project.version,
  };
}

export async function changeProjectLifecycle(
  pool: Pool,
  projectId: string,
  rawInput: LifecycleCommandInput,
  context: ProjectLifecycleContext,
): Promise<Project> {
  assertCanonicalUuid(projectId);
  assertCanonicalUuid(context.actorId);
  const input = lifecycleCommandInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findProjectForUpdate(connection, projectId);
    if (!before) throw new ProjectNotFoundError();
    if (before.version !== input.version) {
      throw new ProjectVersionConflictError();
    }

    if (input.action === "archive") {
      if (
        before.archivedAtUtc !== null ||
        (before.status !== "completed" && before.status !== "cancelled")
      ) {
        throw new LifecycleStateConflictError();
      }
      if (await projectHasLifecycleDependencies(connection, projectId)) {
        throw new LifecycleDependencyConflictError();
      }
    } else if (before.archivedAtUtc === null) {
      throw new LifecycleStateConflictError();
    }

    const after: Project = {
      ...before,
      archiveReason: input.action === "archive" ? input.reason! : null,
      archivedAtUtc: input.action === "archive" ? now : null,
      archivedByUserAccountId:
        input.action === "archive" ? context.actorId : null,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateProjectRecord(connection, after, input.version))) {
      throw new ProjectVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: `project.${input.action}d`,
      actorId: context.actorId,
      actorType: "user",
      afterSummary: { ...summary(after), reason: input.reason ?? null },
      beforeSummary: summary(before),
      correlationId: context.correlationId,
      entityId: projectId,
      entityType: "project",
      occurredAtUtc: now,
    });
    return after;
  });
}
