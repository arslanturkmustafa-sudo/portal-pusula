import { z } from "zod";

const ISO_DATE_PATTERN =
  /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const DAY_IN_MILLISECONDS = 86_400_000;
const MAX_REPORT_DAY_SPAN = 365;

function isoDayNumber(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp / DAY_IN_MILLISECONDS;
}

const isoDateSchema = z
  .string()
  .refine((value) => isoDayNumber(value) !== null, "Geçerli bir tarih girin.");

export const cashFlowGranularitySchema = z.enum(["weekly", "monthly"]);

export const cashFlowFilterSchema = z
  .object({
    from: isoDateSchema,
    granularity: cashFlowGranularitySchema,
    to: isoDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const from = isoDayNumber(value.from);
    const to = isoDayNumber(value.to);
    if (from === null || to === null) return;
    if (to < from) {
      context.addIssue({
        code: "custom",
        message: "Bitiş tarihi başlangıç tarihinden önce olamaz.",
        path: ["to"],
      });
      return;
    }
    if (to - from > MAX_REPORT_DAY_SPAN) {
      context.addIssue({
        code: "custom",
        message: "Nakit akışı raporu en fazla 366 günü kapsayabilir.",
        path: ["to"],
      });
    }
  });

export type CashFlowFilter = z.infer<typeof cashFlowFilterSchema>;
export type CashFlowGranularity = z.infer<typeof cashFlowGranularitySchema>;
