import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1000 &&
    year <= 9999 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const optionalDate = z.preprocess(
  emptyToUndefined,
  z.string().refine(isRealIsoDate).optional(),
);

export const taskReportFilterSchema = z
  .object({
    customerId: z.string().regex(CANONICAL_UUID_PATTERN),
    from: optionalDate,
    status: z
      .enum([
        "all",
        "open",
        "backlog",
        "todo",
        "in_progress",
        "blocked",
        "done",
        "cancelled",
      ])
      .default("all"),
    to: optionalDate,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.from === undefined) !== (value.to === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Başlangıç ve bitiş birlikte seçilmelidir.",
        path: [value.from === undefined ? "from" : "to"],
      });
      return;
    }
    if (value.from && value.to) {
      if (value.from > value.to) {
        context.addIssue({
          code: "custom",
          message: "Başlangıç bitişten sonra olamaz.",
          path: ["from"],
        });
        return;
      }
      const dayMilliseconds = 24 * 60 * 60 * 1_000;
      const days =
        (Date.parse(`${value.to}T00:00:00.000Z`) -
          Date.parse(`${value.from}T00:00:00.000Z`)) /
        dayMilliseconds;
      if (days > 366) {
        context.addIssue({
          code: "custom",
          message: "Rapor aralığı 366 günü geçemez.",
          path: ["to"],
        });
      }
    }
  });

export type TaskReportFilter = z.infer<typeof taskReportFilterSchema>;
export type TaskReportStatusFilter = TaskReportFilter["status"];
