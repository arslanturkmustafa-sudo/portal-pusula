import Decimal from "decimal.js";
import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_MONEY = new Decimal("999999999999999.9999");

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

function moneySchema(positive: boolean) {
  return z
    .string()
    .trim()
    .regex(MONEY_PATTERN, "Geçerli bir tutar girin.")
    .refine((value) =>
      positive
        ? new Decimal(value).greaterThan(0)
        : new Decimal(value).greaterThanOrEqualTo(0),
    )
    .transform((value) => new Decimal(value).toFixed(4));
}

const canonicalUuidSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, "Geçerli bir kayıt seçin.");
const isoDateSchema = z
  .string()
  .refine(isRealIsoDate, "Geçerli bir tarih girin.");
const monthSchema = z
  .string()
  .refine(isRealMonth, "Geçerli bir ay girin.");
const optionalNoteSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().min(1).max(2000), z.null()]).default(null),
);

export const generateReceivableInputSchema = z
  .object({
    contractId: canonicalUuidSchema,
    month: monthSchema,
  })
  .strict();

export const financeReceivableListFilterSchema = z
  .object({
    projectId: canonicalUuidSchema.optional(),
  })
  .strict();

export const openingBalanceInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    customerId: canonicalUuidSchema,
    description: z.string().trim().min(1).max(191),
    dueOn: isoDateSchema,
    netAmount: moneySchema(false),
    projectId: canonicalUuidSchema,
    vatAmount: moneySchema(false).default("0.0000"),
  })
  .strict()
  .superRefine((value, context) => {
    const total = new Decimal(value.netAmount).plus(value.vatAmount);
    if (total.lessThanOrEqualTo(0)) {
      context.addIssue({
        code: "custom",
        message: "Toplam alacak sıfırdan büyük olmalıdır.",
        path: ["netAmount"],
      });
    }
    if (total.greaterThan(MAX_MONEY)) {
      context.addIssue({
        code: "custom",
        message: "Toplam alacak desteklenen sınırı aşıyor.",
        path: ["netAmount"],
      });
    }
  });

export const createCollectionInputSchema = z
  .object({
    amount: moneySchema(true),
    clientOperationKey: canonicalUuidSchema,
    collectedOn: isoDateSchema,
    note: optionalNoteSchema,
    receivableId: canonicalUuidSchema,
  })
  .strict();

export type GenerateReceivableInput = z.infer<
  typeof generateReceivableInputSchema
>;
export type FinanceReceivableListFilter = z.infer<
  typeof financeReceivableListFilterSchema
>;
export type OpeningBalanceInput = z.infer<typeof openingBalanceInputSchema>;
export type CreateCollectionInput = z.infer<
  typeof createCollectionInputSchema
>;
