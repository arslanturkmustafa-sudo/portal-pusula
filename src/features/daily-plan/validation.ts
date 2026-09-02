import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const dailyPlanDateSchema = z
  .string()
  .refine(isRealIsoDate, "Geçerli bir tarih girin.");

export const dailyPlanQuerySchema = z
  .object({
    date: dailyPlanDateSchema,
  })
  .strict();

export type DailyPlanQuery = z.infer<typeof dailyPlanQuerySchema>;
