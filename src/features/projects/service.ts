import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  findProjectForUpdate,
  insertProjectRecord,
  listProjectRecords,
  type Project,
  updateProjectRecord,
} from "@/features/projects/repository";
import {
  type CreateProjectInput,
  createProjectInputSchema,
  type UpdateProjectInput,
  updateProjectInputSchema,
} from "@/features/projects/validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class ProjectShortCodeConflictError extends Error {
  constructor() {
    super("Project short code is already in use.");
    this.name = "ProjectShortCodeConflictError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project was not found.");
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectVersionConflictError extends Error {
  constructor() {
    super("Project was changed by another request.");
    this.name = "ProjectVersionConflictError";
  }
}

export type ProjectWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function isTerminal(status: Project["status"]): boolean {
  return status === "completed" || status === "cancelled";
}

function auditSummary(project: Project) {
  return {
    budgetAmount: project.budgetAmount,
    displayName: project.displayName,
    projectType: project.projectType,
    shortCode: project.shortCode,
    startsOn: project.startsOn,
    status: project.status,
    targetEndsOn: project.targetEndsOn,
    version: project.version,
  };
}

export async function listProjects(pool: Pool): Promise<readonly Project[]> {
  return withUtcTransaction(pool, listProjectRecords);
}

export async function createProject(
  pool: Pool,
  rawInput: CreateProjectInput,
  context: ProjectWriteContext,
): Promise<Project> {
  const input = createProjectInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  const project: Project = {
    ...input,
    closedAtUtc: isTerminal(input.status) ? now : null,
    createdAtUtc: now,
    currency: "TRY",
    id: randomUUID(),
    updatedAtUtc: now,
    version: 1,
  };

  try {
    return await withUtcTransaction(pool, async (connection) => {
      await insertProjectRecord(connection, project);
      await appendAuditEvent(connection, {
        action: "project.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: auditSummary(project),
        correlationId: context.correlationId,
        entityId: project.id,
        entityType: "project",
        occurredAtUtc: now,
      });
      return project;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new ProjectShortCodeConflictError();
    throw error;
  }
}

export async function updateProject(
  pool: Pool,
  id: string,
  rawInput: UpdateProjectInput,
  context: ProjectWriteContext,
): Promise<Project> {
  assertCanonicalUuid(id);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = updateProjectInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  try {
    return await withUtcTransaction(pool, async (connection) => {
      const before = await findProjectForUpdate(connection, id);
      if (!before) throw new ProjectNotFoundError();
      if (before.version !== input.version) {
        throw new ProjectVersionConflictError();
      }
      const { version: expectedVersion, ...changes } = input;
      const after: Project = {
        ...before,
        ...changes,
        closedAtUtc: isTerminal(changes.status)
          ? isTerminal(before.status)
            ? before.closedAtUtc
            : now
          : null,
        updatedAtUtc: now,
        version: before.version + 1,
      };
      if (!(await updateProjectRecord(connection, after, expectedVersion))) {
        throw new ProjectVersionConflictError();
      }
      await appendAuditEvent(connection, {
        action: "project.updated",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: auditSummary(after),
        beforeSummary: auditSummary(before),
        correlationId: context.correlationId,
        entityId: after.id,
        entityType: "project",
        occurredAtUtc: now,
      });
      return after;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new ProjectShortCodeConflictError();
    throw error;
  }
}
