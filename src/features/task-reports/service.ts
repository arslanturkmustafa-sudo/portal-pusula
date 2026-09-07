import "server-only";

import type { Pool } from "mysql2/promise";

import {
  findTaskReportCustomer,
  listTaskReportItems,
  type TaskReportCustomer,
  type TaskReportItem,
} from "@/features/task-reports/repository";
import {
  type TaskReportFilter,
  taskReportFilterSchema,
} from "@/features/task-reports/validation";
import { withUtcConsistentRead } from "@/platform/jobs/mysql-transaction";

export class TaskReportCustomerNotFoundError extends Error {
  constructor() {
    super("The task report customer was not found.");
    this.name = "TaskReportCustomerNotFoundError";
  }
}

export class TaskReportTooLargeError extends Error {
  constructor() {
    super("The task report contains more than 1000 records.");
    this.name = "TaskReportTooLargeError";
  }
}

export type CustomerTaskReport = Readonly<{
  customer: TaskReportCustomer;
  filter: TaskReportFilter;
  generatedAtUtc: string;
  generatedOn: string;
  summary: Readonly<{
    completed: number;
    open: number;
    overdue: number;
    total: number;
  }>;
  tasks: readonly TaskReportItem[];
}>;

function istanbulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function composeCustomerTaskReport(
  customer: TaskReportCustomer,
  filter: TaskReportFilter,
  tasks: readonly TaskReportItem[],
  now: Date,
): CustomerTaskReport {
  if (tasks.length > 1_000) throw new TaskReportTooLargeError();
  const generatedOn = istanbulDate(now);
  return {
    customer,
    filter,
    generatedAtUtc: now.toISOString(),
    generatedOn,
    summary: {
      completed: tasks.filter((task) => task.status === "done").length,
      open: tasks.filter(
        (task) => task.status !== "done" && task.status !== "cancelled",
      ).length,
      overdue: tasks.filter(
        (task) =>
          task.status !== "done" &&
          task.status !== "cancelled" &&
          task.dueOn !== null &&
          task.dueOn < generatedOn,
      ).length,
      total: tasks.length,
    },
    tasks,
  };
}

export async function getCustomerTaskReport(
  pool: Pool,
  rawFilter: TaskReportFilter,
  now = new Date(),
): Promise<CustomerTaskReport> {
  const filter = taskReportFilterSchema.parse(rawFilter);
  return withUtcConsistentRead(pool, async (connection) => {
    const customer = await findTaskReportCustomer(connection, filter.customerId);
    if (!customer) throw new TaskReportCustomerNotFoundError();
    const tasks = await listTaskReportItems(connection, filter);
    return composeCustomerTaskReport(customer, filter, tasks, now);
  });
}
