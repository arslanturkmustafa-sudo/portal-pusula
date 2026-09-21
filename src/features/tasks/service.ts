import { type ProjectScope, requireProjectAccess } from "@/platform/auth/project-access";
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
  findTaskGeneratedFromTaskId,
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
  taskRecurrenceStateSchema,
  updateTaskInputSchema,
} from "@/features/tasks/validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import {
  nextOccurrenceOn,
  recurrenceAnchorDay,
} from "@/platform/recurrence/schedule";
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
  projectIds?: ProjectScope;
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
    recurrenceAnchorDay: task.recurrenceAnchorDay,
    recurrenceEndsOn: task.recurrenceEndsOn,
    recurrenceFrequency: task.recurrenceFrequency,
    recurrenceGeneratedFromTaskId: task.recurrenceGeneratedFromTaskId,
    recurrenceSeriesId: task.recurrenceSeriesId,
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

async function insertTaskWithAudit(
  connection: PoolConnection,
  task: WorkTaskState,
  context: TaskWriteContext,
  now: string,
  action: "task.created" | "task.recurrence_generated",
): Promise<void> {
  await insertTaskRecord(connection, task);
  await replaceTaskProjectRecord(connection, task.id, task.projectId, now);
  await appendAuditEvent(connection, {
    action,
    actorId: context.actorId,
    actorType: "user",
    afterSummary: auditSummary(task),
    correlationId: context.correlationId,
    entityId: task.id,
    entityType: "work_task",
    occurredAtUtc: now,
  });
}

async function generateNextRecurringTask(
  connection: PoolConnection,
  source: WorkTaskState,
  context: TaskWriteContext,
  now: string,
): Promise<void> {
  if (
    source.recurrenceFrequency === null ||
    source.recurrenceAnchorDay === null ||
    source.recurrenceSeriesId === null ||
    source.dueOn === null
  ) {
    return;
  }
  if ((await findTaskGeneratedFromTaskId(connection, source.id)) !== null) {
    return;
  }

  const dueOn = nextOccurrenceOn(
    source.dueOn,
    source.recurrenceFrequency,
    source.recurrenceAnchorDay,
  );
  if (source.recurrenceEndsOn !== null && dueOn > source.recurrenceEndsOn) {
    return;
  }

  const task: WorkTaskState = {
    archiveReason: null,
    archivedAtUtc: null,
    archivedByUserAccountId: null,
    assigneeUserAccountId: source.assigneeUserAccountId,
    completedAtUtc: null,
    createdAtUtc: now,
    customerId: source.customerId,
    description: source.description,
    dueOn,
    id: randomUUID(),
    priority: source.priority,
    projectId: source.projectId,
    recurrenceAnchorDay: source.recurrenceAnchorDay,
    recurrenceEndsOn: source.recurrenceEndsOn,
    recurrenceFrequency: source.recurrenceFrequency,
    recurrenceGeneratedFromTaskId: source.id,
    recurrenceSeriesId: source.recurrenceSeriesId,
    status: "todo",
    title: source.title,
    updatedAtUtc: now,
    version: 1,
  };
  await insertTaskWithAudit(
    connection,
    task,
    context,
    now,
    "task.recurrence_generated",
  );
}

export async function listTasks(pool: Pool, projectIds: ProjectScope = null): Promise<readonly WorkTask[]> {
  return withUtcTransaction(pool, (connection) => listTaskRecords(connection, projectIds));
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
  requireProjectAccess(context.projectIds, input.projectId);
  assertCanonicalUuid(taskId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  const assigneeUserAccountId =
    input.assigneeUserAccountId === undefined
      ? (context.actorId ?? null)
      : input.assigneeUserAccountId;
  const recurrenceAnchor =
    input.recurrenceFrequency === null
      ? null
      : recurrenceAnchorDay(input.dueOn!);
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
    recurrenceAnchorDay: recurrenceAnchor,
    recurrenceEndsOn: input.recurrenceEndsOn,
    recurrenceFrequency: input.recurrenceFrequency,
    recurrenceGeneratedFromTaskId: null,
    recurrenceSeriesId:
      input.recurrenceFrequency === null ? null : taskId,
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
  await insertTaskWithAudit(connection, task, context, now, "task.created");
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
    requireProjectAccess(context.projectIds, before.projectId);
    requireProjectAccess(context.projectIds, input.projectId === undefined ? before.projectId : input.projectId);
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
    const recurrenceChanged =
      (changes.recurrenceFrequency !== undefined &&
        changes.recurrenceFrequency !== before.recurrenceFrequency) ||
      (changes.recurrenceEndsOn !== undefined &&
        changes.recurrenceEndsOn !== before.recurrenceEndsOn);
    const statusChanged =
      changes.status !== undefined && changes.status !== before.status;
    // The task row is already locked above. Locking the immutable link in the
    // same transaction keeps the decision and the fenced update atomic.
    const visitLink = await findTaskVisitLinkForUpdate(connection, id);
    if (
      visitLink !== null &&
      (customerChanged ||
        dueOnChanged ||
        projectChanged ||
        recurrenceChanged ||
        statusChanged)
    ) {
      throw new TaskVisitLinkedFieldsLockedError();
    }
    const nextStatus = changes.status ?? before.status;
    const nextDueOn =
      changes.dueOn === undefined ? before.dueOn : changes.dueOn;
    const nextRecurrenceFrequency =
      changes.recurrenceFrequency === undefined
        ? before.recurrenceFrequency
        : changes.recurrenceFrequency;
    const nextRecurrenceEndsOn =
      nextRecurrenceFrequency === null
        ? null
        : changes.recurrenceEndsOn === undefined
          ? before.recurrenceEndsOn
          : changes.recurrenceEndsOn;
    taskRecurrenceStateSchema.parse({
      dueOn: nextDueOn,
      recurrenceEndsOn: nextRecurrenceEndsOn,
      recurrenceFrequency: nextRecurrenceFrequency,
    });
    const nextRecurrenceAnchorDay =
      nextRecurrenceFrequency === null
        ? null
        : before.recurrenceFrequency === nextRecurrenceFrequency &&
            before.recurrenceAnchorDay !== null &&
            !dueOnChanged
          ? before.recurrenceAnchorDay
          : recurrenceAnchorDay(nextDueOn!);
    const after: WorkTaskState = {
      ...before,
      ...changes,
      completedAtUtc:
        nextStatus === "done"
          ? before.status === "done"
            ? before.completedAtUtc
            : now
          : null,
      dueOn: nextDueOn,
      recurrenceAnchorDay: nextRecurrenceAnchorDay,
      recurrenceEndsOn: nextRecurrenceEndsOn,
      recurrenceFrequency: nextRecurrenceFrequency,
      recurrenceSeriesId:
        nextRecurrenceFrequency === null
          ? null
          : (before.recurrenceSeriesId ?? before.id),
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
    if (before.status !== "done" && after.status === "done") {
      await generateNextRecurringTask(connection, after, context, now);
    }
    return taskProjection(connection, after.id);
  });
}
