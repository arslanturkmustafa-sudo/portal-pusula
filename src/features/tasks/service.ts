import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool, PoolConnection } from "mysql2/promise";

import { findUserAccountById } from "@/features/account/repository";
import {
  findActiveCustomerProjectForUpdate,
  findCustomerForUpdate,
} from "@/features/customers/repository";
import { findProjectForUpdate } from "@/features/projects/repository";
import { LifecycleArchivedRecordError } from "@/features/lifecycle";
import {
  findTaskRecordById,
  findTaskStateForUpdate,
  insertTaskRecord,
  listTaskRecords,
  replaceTaskProjectRecord,
  type WorkTask,
  type WorkTaskState,
  updateTaskRecord,
} from "@/features/tasks/repository";
import { findTaskVisitLinkForUpdate } from "@/features/tasks/visit-repository";
import {
  type CreateTaskInput,
  createTaskInputSchema,
  type UpdateTaskInput,
  updateTaskInputSchema,
} from "@/features/tasks/validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class TaskNotFoundError extends Error {
  constructor() {
    super("Task was not found.");
    this.name = "TaskNotFoundError";
  }
}

export class TaskCustomerNotFoundError extends Error {
  constructor() {
    super("Task customer was not found.");
    this.name = "TaskCustomerNotFoundError";
  }
}

export class TaskAssigneeNotFoundError extends Error {
  constructor() {
    super("Task assignee was not found or inactive.");
    this.name = "TaskAssigneeNotFoundError";
  }
}

export class TaskProjectNotFoundError extends Error {
  constructor() {
    super("Task project was not found.");
    this.name = "TaskProjectNotFoundError";
  }
}

export class TaskCustomerProjectMismatchError extends Error {
  constructor() {
    super("Task customer is not actively linked to the selected project.");
    this.name = "TaskCustomerProjectMismatchError";
  }
}

export class TaskVersionConflictError extends Error {
  constructor() {
    super("Task was changed by another request.");
    this.name = "TaskVersionConflictError";
  }
}

export class TaskVisitLinkedFieldsLockedError extends Error {
  constructor() {
    super("Visit-linked task schedule fields are locked.");
    this.name = "TaskVisitLinkedFieldsLockedError";
  }
}

export type TaskWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

function auditSummary(task: WorkTaskState) {
  return {
    assigneeUserAccountId: task.assigneeUserAccountId,
    customerId: task.customerId,
    dueOn: task.dueOn,
    priority: task.priority,
    projectId: task.projectId,
    status: task.status,
    title: task.title,
    version: task.version,
  };
}

async function assertTaskReferences(
  connection: PoolConnection,
  customerId: string | null,
  assigneeUserAccountId: string | null,
  projectId: string | null,
): Promise<void> {
  if (customerId !== null) {
    const customer = await findCustomerForUpdate(connection, customerId);
    if (!customer || customer.archivedAtUtc !== null) {
      throw new TaskCustomerNotFoundError();
    }
  }

  if (assigneeUserAccountId !== null) {
    const assignee = await findUserAccountById(
      connection,
      assigneeUserAccountId,
    );
    if (!assignee || assignee.status !== "active") {
      throw new TaskAssigneeNotFoundError();
    }
  }

  if (projectId !== null) {
    const project = await findProjectForUpdate(connection, projectId);
    if (!project || project.archivedAtUtc !== null) {
      throw new TaskProjectNotFoundError();
    }
  }

  if (
    customerId !== null &&
    projectId !== null &&
    !(await findActiveCustomerProjectForUpdate(connection, customerId, projectId))
  ) {
    throw new TaskCustomerProjectMismatchError();
  }
}

async function taskProjection(
  connection: PoolConnection,
  id: string,
): Promise<WorkTask> {
  const task = await findTaskRecordById(connection, id);
  if (!task) throw new Error("Task projection failed.");
  return task;
}

export async function listTasks(pool: Pool): Promise<readonly WorkTask[]> {
  return withUtcTransaction(pool, listTaskRecords);
}

export async function createTask(
  pool: Pool,
  rawInput: CreateTaskInput,
  context: TaskWriteContext,
): Promise<WorkTask> {
  return withUtcTransaction(pool, (connection) =>
    createTaskInTransaction(connection, rawInput, context),
  );
}

export async function createTaskInTransaction(
  connection: PoolConnection,
  rawInput: CreateTaskInput,
  context: TaskWriteContext,
  taskId: string = randomUUID(),
): Promise<WorkTask> {
  const input = createTaskInputSchema.parse(rawInput);
  assertCanonicalUuid(taskId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  const assigneeUserAccountId =
    input.assigneeUserAccountId === undefined
      ? (context.actorId ?? null)
      : input.assigneeUserAccountId;
  const task: WorkTaskState = {
    archiveReason: null,
    archivedAtUtc: null,
    archivedByUserAccountId: null,
    assigneeUserAccountId,
    completedAtUtc: input.status === "done" ? now : null,
    createdAtUtc: now,
    customerId: input.customerId,
    description: input.description,
    dueOn: input.dueOn,
    id: taskId,
    priority: input.priority,
    projectId: input.projectId,
    status: input.status,
    title: input.title,
    updatedAtUtc: now,
    version: 1,
  };

  await assertTaskReferences(
    connection,
    task.customerId,
    task.assigneeUserAccountId,
    task.projectId,
  );
  await insertTaskRecord(connection, task);
  await replaceTaskProjectRecord(connection, task.id, task.projectId, now);
  await appendAuditEvent(connection, {
    action: "task.created",
    actorId: context.actorId,
    actorType: "user",
    afterSummary: auditSummary(task),
    correlationId: context.correlationId,
    entityId: task.id,
    entityType: "work_task",
    occurredAtUtc: now,
  });
  return taskProjection(connection, task.id);
}

export async function updateTask(
  pool: Pool,
  id: string,
  rawInput: UpdateTaskInput,
  context: TaskWriteContext,
): Promise<WorkTask> {
  assertCanonicalUuid(id);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = updateTaskInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findTaskStateForUpdate(connection, id);
    if (!before) throw new TaskNotFoundError();
    if (before.archivedAtUtc !== null) {
      throw new LifecycleArchivedRecordError();
    }
    if (before.version !== input.version) {
      throw new TaskVersionConflictError();
    }

    const {
      version: expectedVersion,
      ...changes
    } = input;
    const customerChanged =
      changes.customerId !== undefined &&
      changes.customerId !== before.customerId;
    const dueOnChanged =
      changes.dueOn !== undefined && changes.dueOn !== before.dueOn;
    const projectChanged =
      changes.projectId !== undefined && changes.projectId !== before.projectId;
    const statusChanged =
      changes.status !== undefined && changes.status !== before.status;
    // The task row is already locked above. Locking the immutable link in the
    // same transaction keeps the decision and the fenced update atomic.
    const visitLink = await findTaskVisitLinkForUpdate(connection, id);
    if (
      visitLink !== null &&
      (customerChanged || dueOnChanged || projectChanged || statusChanged)
    ) {
      throw new TaskVisitLinkedFieldsLockedError();
    }
    const nextStatus = changes.status ?? before.status;
    const after: WorkTaskState = {
      ...before,
      ...changes,
      completedAtUtc:
        nextStatus === "done"
          ? before.status === "done"
            ? before.completedAtUtc
            : now
          : null,
      status: nextStatus,
      updatedAtUtc: now,
      version: before.version + 1,
    };

    if (
      customerChanged ||
      changes.assigneeUserAccountId !== undefined ||
      projectChanged
    ) {
      await assertTaskReferences(
        connection,
        after.customerId,
        after.assigneeUserAccountId,
        after.projectId,
      );
    } else if (
      after.status !== "done" &&
      after.status !== "cancelled" &&
      after.customerId !== null &&
      after.projectId !== null &&
      !(await findActiveCustomerProjectForUpdate(
        connection,
        after.customerId,
        after.projectId,
      ))
    ) {
      throw new TaskCustomerProjectMismatchError();
    }
    if (!(await updateTaskRecord(connection, after, expectedVersion))) {
      throw new TaskVersionConflictError();
    }
    if (projectChanged) {
      await replaceTaskProjectRecord(connection, after.id, after.projectId, now);
    }
    await appendAuditEvent(connection, {
      action: "task.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: auditSummary(after),
      beforeSummary: auditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "work_task",
      occurredAtUtc: now,
    });
    return taskProjection(connection, after.id);
  });
}
