import "server-only";

import type { Pool } from "mysql2/promise";

import {
  type DailyAgendaItem,
  listDailyAgendaItems,
} from "@/features/daily-plan/repository";
import {
  dailyPlanDateSchema,
  dailyPlanViewSchema,
  type DailyPlanView,
} from "@/features/daily-plan/validation";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";

export const MAX_DAILY_PLAN_RANGE_DAYS = 31;

export type DailyAgendaRange = Readonly<{
  endDate: string;
  startDate: string;
}>;

export type DailyAgenda = Readonly<{
  date: string;
  items: readonly DailyAgendaItem[];
  range: DailyAgendaRange;
  view: DailyPlanView;
}>;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const MIN_PLAN_DATE = "1000-01-01";
const MAX_PLAN_DATE = "9999-12-31";

function dateParts(value: string): readonly [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

function dateAtNoonUtc(value: string): Date {
  const [year, month, day] = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function canonicalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clampDate(value: string): string {
  if (value < MIN_PLAN_DATE) return MIN_PLAN_DATE;
  if (value > MAX_PLAN_DATE) return MAX_PLAN_DATE;
  return value;
}

function shiftDays(value: string, days: number): string {
  const shifted = dateAtNoonUtc(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  if (shifted.getUTCFullYear() < 1000) return MIN_PLAN_DATE;
  if (shifted.getUTCFullYear() > 9999) return MAX_PLAN_DATE;
  return clampDate(canonicalDate(shifted));
}

function monthRange(value: string): DailyAgendaRange {
  const [year, month] = dateParts(value);
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const canonicalMonth = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return {
    endDate: `${canonicalMonth}-${String(lastDay).padStart(2, "0")}`,
    startDate: `${canonicalMonth}-01`,
  };
}

function rangeDayCount(range: DailyAgendaRange): number {
  return (
    Math.round(
      (dateAtNoonUtc(range.endDate).getTime() -
        dateAtNoonUtc(range.startDate).getTime()) /
        DAY_MILLISECONDS,
    ) + 1
  );
}

export function dailyAgendaRange(
  rawDate: unknown,
  rawView: unknown = "day",
): Readonly<{ date: string; range: DailyAgendaRange; view: DailyPlanView }> {
  const date = dailyPlanDateSchema.parse(rawDate);
  const view = dailyPlanViewSchema.parse(rawView);

  let range: DailyAgendaRange;
  if (view === "month") {
    range = monthRange(date);
  } else if (view === "week") {
    const dayOfWeek = dateAtNoonUtc(date).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    range = {
      endDate: shiftDays(date, 6 - daysSinceMonday),
      startDate: shiftDays(date, -daysSinceMonday),
    };
  } else {
    range = { endDate: date, startDate: date };
  }

  if (rangeDayCount(range) > MAX_DAILY_PLAN_RANGE_DAYS) {
    throw new Error("Daily plan range exceeds its maximum size.");
  }

  return { date, range, view };
}

export async function getDailyAgenda(
  pool: Pool,
  rawDate: unknown,
  rawView: unknown = "day",
): Promise<DailyAgenda> {
  const { date, range, view } = dailyAgendaRange(rawDate, rawView);
  return withUtcTransaction(pool, async (connection) => ({
    date,
    items: await listDailyAgendaItems(
      connection,
      range.startDate,
      range.endDate,
    ),
    range,
    view,
  }));
}
