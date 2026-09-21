import { type ProjectScope, projectScopeSql } from "@/platform/auth/project-access";
import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  mapArchiveMetadata,
  type ArchiveMetadata,
} from "@/features/lifecycle";
import type { RecurrenceFrequency } from "@/platform/recurrence/schedule";

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskRecurrenceFrequency = RecurrenceFrequency;

export type WorkTaskState = ArchiveMetadata & Readonly<{
  assigneeUserAccountId: string | null;
  completedAtUtc: string | null;
  createdAtUtc: string;
  customerId: string | null;
  description: string | null;
  dueOn: string | null;
  id: string;
  priority: TaskPriority;
  projectId: string | null;
  recurrenceAnchorDay: number | null;
  recurrenceEndsOn: string | null;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceGeneratedFromTaskId: string | null;
  recurrenceSeriesId: string | null;
  status: TaskStatus;
  title: string;
  updatedAtUtc: string;
  version: number;
}>;

export type WorkTask = WorkTaskState &
  Readonly<{
    assigneeEmail: string | null;
    customerCode: string | null;
    customerName: string | null;
    projectCode: string | null;
    projectName: string | null;
    visitLinked: boolean;
    bypusula?: { id: string; analysisId: string; companyName: string; programCode: string } | null;
  }>;

type WorkTaskStateRow = RowDataPacket & {
  archive_reason: string | null;
  archived_at_utc: string | Date | null;
  archived_by_user_account_id: string | null;
  assignee_user_account_id: string | null;
  completed_at_utc: string | Date | null;
  created_at_utc: string | Date;
  customer_id: string | null;
  description: string | null;
  due_on: string | Date | null;
  id: string;
  priority: string;
  project_id: string | null;
  recurrence_anchor_day: number | null;
  recurrence_ends_on: string | Date | null;
  recurrence_frequency: string | null;
  recurrence_generated_from_task_id: string | null;
  recurrence_series_id: string | null;
  status: string;
  title: string;
  updated_at_utc: string | Date;
  version: number;
};

type WorkTaskRow = WorkTaskStateRow & {
  bypusula_id: string | null;
  bypusula_analysis_id: string | null;
  bypusula_company_name: string | null;
  bypusula_step_key: string | null;
  assignee_email: string | null;
  customer_code: string | null;
  customer_name: string | null;
  linked_visit_id: string | null;
  project_code: string | null;
  project_name: string | null;
};

type GeneratedTaskRow = RowDataPacket & { id: string };

function canonicalDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function taskStatus(value: string): TaskStatus {
  if (
    value !== "backlog" &&
    value !== "todo" &&
    value !== "in_progress" &&
    value !== "blocked" &&
    value !== "done" &&
    value !== "cancelled"
  ) {
    throw new Error("Task status is invalid.");
  }
  return value;
}

function taskPriority(value: string): TaskPriority {
  if (
    value !== "low" &&
    value !== "normal" &&
    value !== "high" &&
    value !== "urgent"
  ) {
    throw new Error("Task priority is invalid.");
  }
  return value;
}

function taskRecurrenceFrequency(
  value: string | null,
): RecurrenceFrequency | null {
  if (value === null) return null;
  if (value !== "daily" && value !== "weekly" && value !== "monthly") {
    throw new Error("Task recurrence frequency is invalid.");
  }
  return value;
}

function mapTaskState(row: WorkTaskStateRow): WorkTaskState {
  const recurrenceFrequency = taskRecurrenceFrequency(row.recurrence_frequency);
  if (
    (recurrenceFrequency === null &&
      (row.recurrence_anchor_day !== null ||
        row.recurrence_ends_on !== null ||
        row.recurrence_series_id !== null)) ||
    (recurrenceFrequency !== null &&
      (row.due_on === null ||
        row.recurrence_series_id === null ||
        row.recurrence_anchor_day === null ||
        !Number.isInteger(row.recurrence_anchor_day) ||
        row.recurrence_anchor_day < 1 ||
        row.recurrence_anchor_day > 31))
  ) {
    throw new Error("Task recurrence projection is invalid.");
  }
  return {
    ...mapArchiveMetadata(row),
    assigneeUserAccountId: row.assignee_user_account_id,
    completedAtUtc:
      row.completed_at_utc === null
        ? null
        : canonicalDateTime(row.completed_at_utc),
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    customerId: row.customer_id,
    description: row.description,
    dueOn: row.due_on === null ? null : canonicalDate(row.due_on),
    id: row.id,
    priority: taskPriority(row.priority),
    projectId: row.project_id,
    recurrenceAnchorDay: row.recurrence_anchor_day,
    recurrenceEndsOn:
      row.recurrence_ends_on === null
        ? null
        : canonicalDate(row.recurrence_ends_on),
    recurrenceFrequency,
    recurrenceGeneratedFromTaskId: row.recurrence_generated_from_task_id,
    recurrenceSeriesId: row.recurrence_series_id,
    status: taskStatus(row.status),
    title: row.title,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
  };
}

function mapWorkTask(row: WorkTaskRow): WorkTask {
  if (
    (row.customer_id === null &&
      (row.customer_code !== null || row.customer_name !== null)) ||
    (row.customer_id !== null &&
      (row.customer_code === null || row.customer_name === null))
  ) {
    throw new Error("Task customer projection is invalid.");
  }
  if ((row.assignee_user_account_id === null) !== (row.assignee_email === null)) {
    throw new Error("Task assignee projection is invalid.");
  }
  if (
    (row.project_id === null &&
      (row.project_code !== null || row.project_name !== null)) ||
    (row.project_id !== null &&
      (row.project_code === null || row.project_name === null))
  ) {
    throw new Error("Task project projection is invalid.");
  }

  return {
    ...mapTaskState(row),
    assigneeEmail: row.assignee_email,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    projectCode: row.project_code,
    projectName: row.project_name,
    visitLinked: row.linked_visit_id !== null,
    bypusula: row.bypusula_id && row.bypusula_analysis_id && row.bypusula_company_name && row.bypusula_step_key ? {
      id: row.bypusula_id,
      analysisId: row.bypusula_analysis_id,
      companyName: row.bypusula_company_name,
      programCode: row.bypusula_step_key.split("/")[0],
    } : null,
  };
}

const TASK_STATE_COLUMNS = `
  task.id, task.customer_id, task.assignee_user_account_id,
  task_link.project_id,
  task.title, task.description, task.status, task.priority, task.due_on,
  task.recurrence_frequency, task.recurrence_anchor_day,
  task.recurrence_ends_on, task.recurrence_series_id,
  task.recurrence_generated_from_task_id,
  task.completed_at_utc, task.archive_reason, task.archived_at_utc,
  task.archived_by_user_account_id, task.version, task.created_at_utc,
  task.updated_at_utc`;

const TASK_PROJECTION_COLUMNS = `${TASK_STATE_COLUMNS},
  customer.display_name AS customer_name,
  customer.short_code AS customer_code,
  project.display_name AS project_name,
  project.short_code AS project_code,
  assignee.email AS assignee_email,
  task_visit.visit_id AS linked_visit_id,
  bypusula.id AS bypusula_id, bypusula.analysis_id AS bypusula_analysis_id,
  bypusula.company_name AS bypusula_company_name,
  bypusula_link.step_key AS bypusula_step_key`;

const TASK_PROJECTION_JOIN = `
  FROM work_task AS task
  LEFT JOIN work_task_project AS task_link ON task_link.task_id = task.id
  LEFT JOIN project ON project.id = task_link.project_id
  LEFT JOIN customer ON customer.id = task.customer_id
  LEFT JOIN user_account AS assignee
         ON assignee.id = task.assignee_user_account_id
  LEFT JOIN work_task_visit AS task_visit ON task_visit.task_id = task.id
  LEFT JOIN bypusula_task_link AS bypusula_link ON bypusula_link.task_id = task.id
  LEFT JOIN bypusula_analysis AS bypusula ON bypusula.id = bypusula_link.analysis_id`;

export async function listTaskRecords(
  connection: PoolConnection,
  projectIds: ProjectScope = null,
): Promise<readonly WorkTask[]> {
  const scope = projectScopeSql("task_link.project_id", projectIds);
  const [rows] = await connection.execute<WorkTaskRow[]>(
    `SELECT ${TASK_PROJECTION_COLUMNS}
       ${TASK_PROJECTION_JOIN}
      WHERE ${scope.sql}
      ORDER BY task.archived_at_utc IS NULL DESC,
               FIELD(task.status, 'backlog', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'),
               FIELD(task.priority, 'urgent', 'high', 'normal', 'low'),
               task.due_on IS NULL ASC,
               task.due_on ASC,
               task.updated_at_utc DESC,
               task.id ASC`,
    scope.values,
  );
  return rows.map(mapWorkTask);
}

export async function findTaskRecordById(
  connection: PoolConnection,
  id: string,
): Promise<WorkTask | null> {
  const [rows] = await connection.execute<WorkTaskRow[]>(
    `SELECT ${TASK_PROJECTION_COLUMNS}
       ${TASK_PROJECTION_JOIN}
      WHERE task.id = ?
      LIMIT 1`,
    [id],
  );
  return rows[0] ? mapWorkTask(rows[0]) : null;
}

export async function findTaskStateForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<WorkTaskState | null> {
  const [rows] = await connection.execute<WorkTaskStateRow[]>(
    `SELECT ${TASK_STATE_COLUMNS}
       FROM work_task AS task
       LEFT JOIN work_task_project AS task_link ON task_link.task_id = task.id
      WHERE task.id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapTaskState(rows[0]) : null;
}

export async function insertTaskRecord(
  connection: PoolConnection,
  task: WorkTaskState,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO work_task
       (id, customer_id, assignee_user_account_id, title, description,
        status, priority, due_on, recurrence_frequency,
        recurrence_anchor_day, recurrence_ends_on, recurrence_series_id,
        recurrence_generated_from_task_id, completed_at_utc, version,
        archive_reason, archived_at_utc, archived_by_user_account_id,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.customerId,
      task.assigneeUserAccountId,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.dueOn,
      task.recurrenceFrequency,
      task.recurrenceAnchorDay,
      task.recurrenceEndsOn,
      task.recurrenceSeriesId,
      task.recurrenceGeneratedFromTaskId,
      task.completedAtUtc,
      task.version,
      task.archiveReason,
      task.archivedAtUtc,
      task.archivedByUserAccountId,
      task.createdAtUtc,
      task.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Task insert failed.");
}

export async function updateTaskRecord(
  connection: PoolConnection,
  task: WorkTaskState,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE work_task
        SET customer_id = ?, assignee_user_account_id = ?, title = ?,
            description = ?, status = ?, priority = ?, due_on = ?,
            recurrence_frequency = ?, recurrence_anchor_day = ?,
            recurrence_ends_on = ?, recurrence_series_id = ?,
            recurrence_generated_from_task_id = ?, completed_at_utc = ?,
            archive_reason = ?, archived_at_utc = ?,
            archived_by_user_account_id = ?, version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      task.customerId,
      task.assigneeUserAccountId,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.dueOn,
      task.recurrenceFrequency,
      task.recurrenceAnchorDay,
      task.recurrenceEndsOn,
      task.recurrenceSeriesId,
      task.recurrenceGeneratedFromTaskId,
      task.completedAtUtc,
      task.archiveReason,
      task.archivedAtUtc,
      task.archivedByUserAccountId,
      task.version,
      task.updatedAtUtc,
      task.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}

export async function findTaskGeneratedFromTaskId(
  connection: PoolConnection,
  sourceTaskId: string,
): Promise<string | null> {
  const [rows] = await connection.execute<GeneratedTaskRow[]>(
    `SELECT id
       FROM work_task
      WHERE recurrence_generated_from_task_id = ?
      LIMIT 1
      FOR UPDATE`,
    [sourceTaskId],
  );
  return rows[0]?.id ?? null;
}

export async function replaceTaskProjectRecord(
  connection: PoolConnection,
  taskId: string,
  projectId: string | null,
  now: string,
): Promise<void> {
  if (projectId === null) {
    await connection.execute<ResultSetHeader>(
      `DELETE FROM work_task_project WHERE task_id = ?`,
      [taskId],
    );
    return;
  }

  await connection.execute<ResultSetHeader>(
    `INSERT INTO work_task_project
       (task_id, project_id, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE project_id = ?, updated_at_utc = ?`,
    [taskId, projectId, now, now, projectId, now],
  );
}
