import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

export const dailyPlanViewSchema = z.enum(["day", "week", "month"]);

export const dailyPlanCustomerIdSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, "Geçerli bir müşteri seçin.");

export const dailyPlanLocationLabelSchema = z
  .string()
  .trim()
  .min(1, "Geçerli bir konum seçin.")
  .max(191, "Konum en fazla 191 karakter olabilir.");

export const dailyPlanQuerySchema = z
  .object({
    date: dailyPlanDateSchema,
    view: dailyPlanViewSchema.default("day"),
  })
  .strict();

export const dailyPlanExportQuerySchema = z
  .object({
    customerId: dailyPlanCustomerIdSchema,
    date: dailyPlanDateSchema,
    format: z.enum(["ics", "print"]),
    location: dailyPlanLocationLabelSchema.optional(),
    view: dailyPlanViewSchema.default("day"),
  })
  .strict();

export type DailyPlanQuery = z.infer<typeof dailyPlanQuerySchema>;
export type DailyPlanExportQuery = z.infer<typeof dailyPlanExportQuerySchema>;
export type DailyPlanView = z.infer<typeof dailyPlanViewSchema>;
