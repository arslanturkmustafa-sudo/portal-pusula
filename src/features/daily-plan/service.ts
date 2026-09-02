import "server-only";

import type { Pool } from "mysql2/promise";

import {
  type DailyAgendaItem,
  listDailyAgendaItems,
} from "@/features/daily-plan/repository";
import { dailyPlanDateSchema } from "@/features/daily-plan/validation";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";

export type DailyAgenda = Readonly<{
  date: string;
  items: readonly DailyAgendaItem[];
}>;

export async function getDailyAgenda(
  pool: Pool,
  rawDate: unknown,
): Promise<DailyAgenda> {
  const date = dailyPlanDateSchema.parse(rawDate);
  return withUtcTransaction(pool, async (connection) => ({
    date,
    items: await listDailyAgendaItems(connection, date),
  }));
}
