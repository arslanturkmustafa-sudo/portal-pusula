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
