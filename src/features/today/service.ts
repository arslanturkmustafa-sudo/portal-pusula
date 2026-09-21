import type { ProjectScope } from "@/platform/auth/project-access";
import { listTaskRecords } from "@/features/tasks/repository";
import "server-only";

import type { Pool, PoolConnection } from "mysql2/promise";

import {
  type DailyAgendaItem,
  type DailyPlanTask,
  listDailyAgendaItems,
  listDailyPlanTasks,
} from "@/features/daily-plan";
import {
  type FinanceDigestItem,
  listOpenFinanceDigestItems,
} from "@/features/finance/finance-digest-repository";
import { withUtcConsistentRead } from "@/platform/jobs/mysql-transaction";

export type TodayOverviewAccess = Readonly<{
  projectIds?: ProjectScope;
  canReadFinance: boolean;
  canReadTasks: boolean;
  canReadVisits: boolean;
}>;

export type TodayOverview = Readonly<{
  businessDate: string;
  financeItems?: readonly FinanceDigestItem[];
  tasks: readonly DailyPlanTask[];
  visits: readonly DailyAgendaItem[];
}>;

export function openTodayVisits(
  visits: readonly DailyAgendaItem[],
): readonly DailyAgendaItem[] {
  return visits.filter(
    (visit) =>
      visit.resolutionStatus === "planned" ||
      visit.resolutionStatus === "makeup_pending",
  );
}

export function openTodayTasks(
  tasks: readonly DailyPlanTask[],
): readonly DailyPlanTask[] {
  return tasks.filter((task) => task.status !== "done");
}

export async function readTodayOverview(
  connection: PoolConnection,
  businessDate: string,
  access: TodayOverviewAccess,
): Promise<TodayOverview> {
  if (access.projectIds != null) {
    const scopedTasks = access.canReadTasks ? await listTaskRecords(connection, access.projectIds) : [];
    const tasks = scopedTasks.flatMap((task): DailyPlanTask[] => {
      if (task.archivedAtUtc !== null || task.dueOn !== businessDate || task.status === "done" || task.status === "cancelled") return [];
      return [{ id: task.id, title: task.title, status: task.status, dueOn: task.dueOn,
        calendarOn: task.dueOn, calendarSource: "due_date", customerId: task.customerId,
        customerName: task.customerName, projectName: task.projectName, linkedVisitId: null, locationLabel: null }];
    });
    return { businessDate, tasks, visits: [] };
  }
  const [allVisits, allTasks] = await Promise.all([
    access.canReadVisits
      ? listDailyAgendaItems(connection, businessDate, businessDate)
      : Promise.resolve([]),
    access.canReadTasks
      ? listDailyPlanTasks(connection, businessDate, businessDate)
      : Promise.resolve([]),
  ]);
  const financeItems = access.canReadFinance
    ? await listOpenFinanceDigestItems(connection, businessDate)
    : undefined;

  return {
    businessDate,
    financeItems,
    tasks: openTodayTasks(allTasks),
    visits: openTodayVisits(allVisits),
  };
}

export async function getTodayOverview(
  pool: Pool,
  businessDate: string,
  access: TodayOverviewAccess,
): Promise<TodayOverview> {
  return withUtcConsistentRead(pool, (connection) =>
    readTodayOverview(connection, businessDate, access),
  );
}
