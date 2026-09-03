import Decimal from "decimal.js";
import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isRealMonth(value: string): boolean {
  if (!MONTH_PATTERN.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const isoDateSchema = z
  .string()
  .refine(isRealIsoDate, "Geçerli bir tarih girin.");

export const monthParameterSchema = z
  .string()
  .refine(isRealMonth, "Geçerli bir ay girin.");

const moneySchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN)
  .refine((value) => new Decimal(value).greaterThan(0))
  .transform((value) => new Decimal(value).toFixed(4));

const rateSchema = z
  .string()
  .trim()
  .regex(RATE_PATTERN)
  .refine((value) => new Decimal(value).lessThanOrEqualTo(100))
  .transform((value) => new Decimal(value).toFixed(2));

const nullableNoteSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().min(1).max(2000), z.null()]),
);
const optionalNoteSchema = nullableNoteSchema.default(null);
const projectIdSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, "Geçerli bir proje seçin.");

export const contractStatusSchema = z.enum(["draft", "active", "closed"]);
export const vatModeSchema = z.enum(["exempt", "exclusive", "inclusive"]);

type ContractTerms = Readonly<{
  endsOn: string;
  startsOn: string;
  vatMode: z.infer<typeof vatModeSchema>;
  vatRate: string;
}>;

function validateContractTerms(
  value: ContractTerms,
  context: z.RefinementCtx,
): void {
  if (value.endsOn < value.startsOn) {
    context.addIssue({
      code: "custom",
      message: "Bitiş tarihi başlangıç tarihinden önce olamaz.",
      path: ["endsOn"],
    });
  }

  const rate = new Decimal(value.vatRate);
  const validVat =
    (value.vatMode === "exempt" && rate.isZero()) ||
    (value.vatMode !== "exempt" && rate.greaterThan(0));
  if (!validVat) {
    context.addIssue({
      code: "custom",
      message: "KDV biçimi ile oranı uyumlu değil.",
      path: ["vatRate"],
    });
  }
}

export const createContractInputSchema = z
  .object({
    endsOn: isoDateSchema,
    internalNote: optionalNoteSchema,
    monthlyFeeAmount: moneySchema,
    paymentDay: z.number().int().min(1).max(31),
    projectId: projectIdSchema,
    startsOn: isoDateSchema,
    status: contractStatusSchema.default("active"),
    vatMode: vatModeSchema,
    vatRate: rateSchema,
  })
  .strict()
  .superRefine(validateContractTerms);

// Contract edits deliberately use the same complete terms document as creates.
// Requiring every field keeps PATCH requests deterministic and prevents an
// omitted field from being mistaken for an instruction to clear it.
export const updateContractInputSchema = z
  .object({
    endsOn: isoDateSchema,
    internalNote: nullableNoteSchema,
    monthlyFeeAmount: moneySchema,
    paymentDay: z.number().int().min(1).max(31),
    projectId: projectIdSchema,
    startsOn: isoDateSchema,
    status: contractStatusSchema,
    vatMode: vatModeSchema,
    vatRate: rateSchema,
  })
  .strict()
  .superRefine(validateContractTerms);

const nullableClockSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().regex(CLOCK_PATTERN), z.null()]).default(null),
);

const nullableDurationSchema = z
  .union([z.number().int().min(15).max(720), z.null()])
  .default(null);

export const monthlyVisitPlanInputSchema = z
  .object({
    visits: z
      .array(
        z
          .object({
            committedOn: isoDateSchema,
            internalDurationMinutes: nullableDurationSchema,
            internalStartTime: nullableClockSchema,
          })
          .strict()
          .superRefine((value, context) => {
            const bothEmpty =
              value.internalStartTime === null &&
              value.internalDurationMinutes === null;
            const bothPresent =
              value.internalStartTime !== null &&
              value.internalDurationMinutes !== null;
            if (!bothEmpty && !bothPresent) {
              context.addIssue({
                code: "custom",
                message: "İç saat ve süre birlikte girilmelidir.",
              });
            }
          }),
      )
      .max(31),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, visit] of value.visits.entries()) {
      if (seen.has(visit.committedOn)) {
        context.addIssue({
          code: "custom",
          message: "Aynı gün bir sözleşmede iki kez planlanamaz.",
          path: ["visits", index, "committedOn"],
        });
      }
      seen.add(visit.committedOn);
    }
  });

export const visitResolutionStatusSchema = z.enum([
  "planned",
  "completed",
  "makeup_pending",
  "cancelled_by_agreement",
]);

export const updateVisitResolutionInputSchema = z
  .object({
    deliveredOn: z.union([isoDateSchema, z.null()]).default(null),
    resolutionNote: optionalNoteSchema,
    resolutionStatus: visitResolutionStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.resolutionStatus === "completed") !==
      (value.deliveredOn !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Tamamlanan ziyaretin gerçekleşme günü zorunludur.",
        path: ["deliveredOn"],
      });
    }
    if (
      value.resolutionStatus === "cancelled_by_agreement" &&
      value.resolutionNote === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Mutabakatla iptal için açıklama zorunludur.",
        path: ["resolutionNote"],
      });
    }
  });

export type CreateContractInput = z.infer<typeof createContractInputSchema>;
export type UpdateContractInput = z.infer<typeof updateContractInputSchema>;
export type MonthlyVisitPlanInput = z.infer<
  typeof monthlyVisitPlanInputSchema
>;
export type UpdateVisitResolutionInput = z.infer<
  typeof updateVisitResolutionInputSchema
>;
