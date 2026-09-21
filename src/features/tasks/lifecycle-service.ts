import { type ProjectScope, requireProjectAccess } from "@/platform/auth/project-access";
import "server-only";

import type { Pool } from "mysql2/promise";

import {
  findActiveCustomerProjectForUpdate,
  findCustomerForUpdate,
} from "@/features/customers/repository";
import {
  type LifecycleCommandInput,
  lifecycleCommandInputSchema,
  LifecycleParentUnavailableError,
  LifecycleStateConflictError,
} from "@/features/lifecycle";
import { findProjectForUpdate } from "@/features/projects/repository";
import {
  findTaskStateForUpdate,
  type WorkTaskState,
  updateTaskRecord,
} from "@/features/tasks/repository";
import {
  TaskNotFoundError,
  TaskVersionConflictError,
} from "@/features/tasks/service";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export type TaskLifecycleContext = Readonly<{
  actorId: string;
  projectIds?: ProjectScope;
  correlationId: string;
  now?: Date;
}>;

async function assertAvailableParents(
  connection: Parameters<typeof findTaskStateForUpdate>[0],
  task: WorkTaskState,
): Promise<void> {
  if (task.customerId !== null) {
    const customer = await findCustomerForUpdate(connection, task.customerId);
    if (!customer || customer.archivedAtUtc !== null) {
      throw new LifecycleParentUnavailableError();
    }
  }
  if (task.projectId !== null) {
    const project = await findProjectForUpdate(connection, task.projectId);
    if (!project || project.archivedAtUtc !== null) {
      throw new LifecycleParentUnavailableError();
    }
  }
  if (
    task.customerId !== null &&
    task.projectId !== null &&
    !(await findActiveCustomerProjectForUpdate(
      connection,
      task.customerId,
      task.projectId,
    ))
  ) {
    throw new LifecycleParentUnavailableError();
  }
}

function summary(task: WorkTaskState) {
  return {
    archivedAtUtc: task.archivedAtUtc,
    archivedByUserAccountId: task.archivedByUserAccountId,
    status: task.status,
    version: task.version,
  };
}

export async function changeTaskLifecycle(
  pool: Pool,
  taskId: string,
  rawInput: LifecycleCommandInput,
  context: TaskLifecycleContext,
): Promise<WorkTaskState> {
  assertCanonicalUuid(taskId);
  assertCanonicalUuid(context.actorId);
  const input = lifecycleCommandInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findTaskStateForUpdate(connection, taskId);
    if (!before) throw new TaskNotFoundError();
    requireProjectAccess(context.projectIds, before.projectId);
    if (before.version !== input.version) {
      throw new TaskVersionConflictError();
    }

    if (input.action === "archive") {
      if (
        before.archivedAtUtc !== null ||
        (before.status !== "done" && before.status !== "cancelled")
      ) {
        throw new LifecycleStateConflictError();
      }
    } else {
      if (before.archivedAtUtc === null) {
        throw new LifecycleStateConflictError();
      }
      await assertAvailableParents(connection, before);
    }

    const after: WorkTaskState = {
      ...before,
      archiveReason: input.action === "archive" ? input.reason! : null,
      archivedAtUtc: input.action === "archive" ? now : null,
      archivedByUserAccountId:
        input.action === "archive" ? context.actorId : null,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateTaskRecord(connection, after, input.version))) {
      throw new TaskVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: `task.${input.action}d`,
      actorId: context.actorId,
      actorType: "user",
      afterSummary: { ...summary(after), reason: input.reason ?? null },
      beforeSummary: summary(before),
      correlationId: context.correlationId,
      entityId: taskId,
      entityType: "work_task",
      occurredAtUtc: now,
    });
    return after;
  });
}
