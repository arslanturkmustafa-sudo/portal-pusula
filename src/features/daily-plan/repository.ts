import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export type DailyAgendaResolutionStatus =
  | "planned"
  | "completed"
  | "makeup_pending"
  | "cancelled_by_agreement";

export type DailyAgendaItem = Readonly<{
  committedOn: string;
  contractId: string;
  customerCode: string;
  customerId: string;
  customerName: string;
  internalDurationMinutes: number | null;
  internalPlannedAtUtc: string | null;
  resolutionStatus: DailyAgendaResolutionStatus;
  visitId: string;
}>;

export type DailyPlanTaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "blocked"
  | "done";

export type DailyPlanTaskCalendarSource = "visit" | "due_date";

export type DailyPlanTask = Readonly<{
  calendarOn: string;
  calendarSource: DailyPlanTaskCalendarSource;
  customerName: string | null;
  dueOn: string;
  id: string;
  linkedVisitId: string | null;
  projectName: string | null;
  status: DailyPlanTaskStatus;
  title: string;
}>;

type DailyAgendaRow = RowDataPacket & {
  committed_on: string | Date;
  contract_id: string;
  customer_code: string;
  customer_id: string;
  customer_name: string;
  internal_duration_minutes: number | null;
  internal_planned_at_utc: string | Date | null;
  resolution_status: string;
  visit_id: string;
};

type DailyPlanTaskRow = RowDataPacket & {
  calendar_on: string | Date;
  calendar_source: string;
  customer_name: string | null;
  due_on: string | Date;
  id: string;
  linked_visit_id: string | null;
  project_name: string | null;
  status: string;
  title: string;
};

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

function mapDailyAgendaItem(row: DailyAgendaRow): DailyAgendaItem {
  if (
    row.resolution_status !== "planned" &&
    row.resolution_status !== "completed" &&
    row.resolution_status !== "makeup_pending" &&
    row.resolution_status !== "cancelled_by_agreement"
  ) {
    throw new Error("Visit resolution status is invalid.");
  }

  return {
    committedOn: canonicalDate(row.committed_on),
    contractId: row.contract_id,
    customerCode: row.customer_code,
    customerId: row.customer_id,
    customerName: row.customer_name,
    internalDurationMinutes: row.internal_duration_minutes,
    internalPlannedAtUtc:
      row.internal_planned_at_utc === null
        ? null
        : canonicalDateTime(row.internal_planned_at_utc),
    resolutionStatus: row.resolution_status,
    visitId: row.visit_id,
  };
}

function dailyPlanTaskStatus(value: string): DailyPlanTaskStatus {
  if (
    value !== "backlog" &&
    value !== "todo" &&
    value !== "in_progress" &&
    value !== "blocked" &&
    value !== "done"
  ) {
    throw new Error("Task status is invalid.");
  }
  return value;
}

function dailyPlanTaskCalendarSource(
  value: string,
): DailyPlanTaskCalendarSource {
  if (value !== "visit" && value !== "due_date") {
    throw new Error("Task calendar source is invalid.");
  }
  return value;
}

function mapDailyPlanTask(row: DailyPlanTaskRow): DailyPlanTask {
  const calendarSource = dailyPlanTaskCalendarSource(row.calendar_source);
  if (
    (calendarSource === "visit" && row.linked_visit_id === null) ||
    (calendarSource === "due_date" && row.linked_visit_id !== null)
  ) {
    throw new Error("Task calendar visit projection is invalid.");
  }

  return {
    calendarOn: canonicalDate(row.calendar_on),
    calendarSource,
    customerName: row.customer_name,
    dueOn: canonicalDate(row.due_on),
    id: row.id,
    linkedVisitId: row.linked_visit_id,
    projectName: row.project_name,
    status: dailyPlanTaskStatus(row.status),
    title: row.title,
  };
}

export async function listDailyAgendaItems(
  connection: PoolConnection,
  startDate: string,
  endDate: string,
): Promise<readonly DailyAgendaItem[]> {
  const [rows] = await connection.execute<DailyAgendaRow[]>(
    `SELECT visit.id AS visit_id,
            customer.id AS customer_id,
            customer.display_name AS customer_name,
            customer.short_code AS customer_code,
            contract.id AS contract_id,
            visit.committed_on,
            visit.internal_planned_at_utc,
            visit.internal_duration_minutes,
            visit.resolution_status
       FROM monthly_visit_commitment AS visit
       INNER JOIN consulting_contract AS contract
               ON contract.id = visit.contract_id
       INNER JOIN customer
               ON customer.id = contract.customer_id
      WHERE visit.committed_on BETWEEN ? AND ?
      ORDER BY visit.committed_on ASC,
               visit.internal_planned_at_utc IS NULL ASC,
               visit.internal_planned_at_utc ASC,
               visit.id ASC`,
    [startDate, endDate],
  );
  return rows.map(mapDailyAgendaItem);
}

export async function listDailyPlanTasks(
  connection: PoolConnection,
  startDate: string,
  endDate: string,
): Promise<readonly DailyPlanTask[]> {
  const [rows] = await connection.execute<DailyPlanTaskRow[]>(
    `SELECT task.id,
            task.title,
            task.status,
            task.due_on,
            COALESCE(
              exact_visit.committed_on,
              mapped_visit.committed_on,
              task.due_on
            ) AS calendar_on,
            CASE
              WHEN exact_visit.id IS NOT NULL OR mapped_visit.id IS NOT NULL
                THEN 'visit'
              ELSE 'due_date'
            END AS calendar_source,
            COALESCE(exact_visit.id, mapped_visit.id) AS linked_visit_id,
            customer.display_name AS customer_name,
            project.display_name AS project_name
       FROM work_task AS task
       LEFT JOIN customer
              ON customer.id = task.customer_id
       LEFT JOIN work_task_project AS task_project
              ON task_project.task_id = task.id
       LEFT JOIN project
              ON project.id = task_project.project_id
       LEFT JOIN work_task_visit AS exact_visit_link
              ON exact_visit_link.task_id = task.id
       LEFT JOIN monthly_visit_commitment AS exact_visit
              ON exact_visit.id = exact_visit_link.visit_id
       LEFT JOIN monthly_visit_commitment AS mapped_visit
              ON mapped_visit.id = (
                SELECT candidate_visit.id
                  FROM monthly_visit_commitment AS candidate_visit
                  INNER JOIN consulting_contract AS candidate_contract
                          ON candidate_contract.id = candidate_visit.contract_id
                 WHERE candidate_contract.customer_id = task.customer_id
                   AND candidate_visit.resolution_status = 'planned'
                   AND candidate_visit.committed_on <= task.due_on
                 ORDER BY candidate_visit.committed_on DESC,
                          candidate_visit.internal_planned_at_utc DESC,
                          candidate_visit.id DESC
                 LIMIT 1
              )
      WHERE task.archived_at_utc IS NULL
        AND task.due_on IS NOT NULL
        AND (
          task.status IN ('backlog', 'todo', 'in_progress', 'blocked')
          OR (task.status = 'done' AND exact_visit_link.task_id IS NOT NULL)
        )
        AND COALESCE(
              exact_visit.committed_on,
              mapped_visit.committed_on,
              task.due_on
            ) BETWEEN ? AND ?
      ORDER BY calendar_on ASC,
               FIELD(task.status, 'in_progress', 'blocked', 'todo', 'backlog', 'done'),
               task.due_on ASC,
               task.id ASC`,
    [startDate, endDate],
  );
  return rows.map(mapDailyPlanTask);
}
