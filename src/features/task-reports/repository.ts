import { type ProjectScope, projectScopeSql } from "@/platform/auth/project-access";
import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import type { TaskPriority, TaskStatus } from "@/features/tasks";
import type { TaskReportFilter } from "@/features/task-reports/validation";

export type TaskReportCustomer = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: "active" | "inactive";
}>;

export type TaskReportItem = Readonly<{
  assigneeDisplayName: string | null;
  completedAtUtc: string | null;
  description: string | null;
  dueOn: string | null;
  id: string;
  priority: TaskPriority;
  projectCode: string | null;
  projectName: string | null;
  status: TaskStatus;
  title: string;
}>;

type CustomerRow = RowDataPacket & {
  display_name: string;
  id: string;
  short_code: string;
  status: string;
};

type TaskRow = RowDataPacket & {
  assignee_display_name: string | null;
  completed_at_utc: string | Date | null;
  description: string | null;
  due_on: string | Date | null;
  id: string;
  priority: string;
  project_code: string | null;
  project_name: string | null;
  status: string;
  title: string;
};

function canonicalDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function canonicalDateTime(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().replace("T", " ").replace("Z", "000")
    : value;
}

function taskStatus(value: string): TaskStatus {
  if (
    ![
      "backlog",
      "todo",
      "in_progress",
      "blocked",
      "done",
      "cancelled",
    ].includes(value)
  ) {
    throw new Error("Task report status is invalid.");
  }
  return value as TaskStatus;
}

function taskPriority(value: string): TaskPriority {
  if (!["low", "normal", "high", "urgent"].includes(value)) {
    throw new Error("Task report priority is invalid.");
  }
  return value as TaskPriority;
}

export async function findTaskReportCustomer(
  connection: PoolConnection,
  customerId: string,
): Promise<TaskReportCustomer | null> {
  const [rows] = await connection.execute<CustomerRow[]>(
    `SELECT id, display_name, short_code, status
       FROM customer
      WHERE id = ?
      LIMIT 1`,
    [customerId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== "active" && row.status !== "inactive") {
    throw new Error("Task report customer status is invalid.");
  }
  return {
    displayName: row.display_name,
    id: row.id,
    shortCode: row.short_code,
    status: row.status,
  };
}

export async function listTaskReportItems(
  connection: PoolConnection,
  filter: TaskReportFilter,
  projectIds: ProjectScope = null,
): Promise<readonly TaskReportItem[]> {
  const conditions = ["task.customer_id = ?"];
  const parameters: Array<string> = [filter.customerId];
  const scope = projectScopeSql("task_link.project_id", projectIds);
  conditions.push(scope.sql);
  parameters.push(...scope.values);
  if (filter.from && filter.to) {
    conditions.push("task.due_on >= ?", "task.due_on <= ?");
    parameters.push(filter.from, filter.to);
  }
  if (filter.status === "open") {
    conditions.push("task.status IN ('backlog', 'todo', 'in_progress', 'blocked')");
  } else if (filter.status !== "all") {
    conditions.push("task.status = ?");
    parameters.push(filter.status);
  }

  const [rows] = await connection.execute<TaskRow[]>(
    `SELECT task.id, task.title, task.description, task.status, task.priority,
            task.due_on, task.completed_at_utc,
            project.display_name AS project_name,
            project.short_code AS project_code,
            assignee.display_name AS assignee_display_name
       FROM work_task AS task
       LEFT JOIN work_task_project AS task_link ON task_link.task_id = task.id
       LEFT JOIN project ON project.id = task_link.project_id
       LEFT JOIN user_account AS assignee
              ON assignee.id = task.assignee_user_account_id
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY FIELD(task.status, 'backlog', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'),
               task.due_on IS NULL ASC, task.due_on ASC,
               FIELD(task.priority, 'urgent', 'high', 'normal', 'low'),
               task.updated_at_utc DESC, task.id ASC
      LIMIT 1001`,
    parameters,
  );
  return rows.map((row) => ({
    assigneeDisplayName: row.assignee_display_name,
    completedAtUtc:
      row.completed_at_utc === null ? null : canonicalDateTime(row.completed_at_utc),
    description: row.description,
    dueOn: row.due_on === null ? null : canonicalDate(row.due_on),
    id: row.id,
    priority: taskPriority(row.priority),
    projectCode: row.project_code,
    projectName: row.project_name,
    status: taskStatus(row.status),
    title: row.title,
  }));
}
