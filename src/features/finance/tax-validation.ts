import Decimal from "decimal.js";
import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const UNSIGNED_MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const SIGNED_MONEY_PATTERN = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const MAX_MONEY = new Decimal("999999999999999.9999");

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

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

function isRealMonth(value: string): boolean {
  if (!MONTH_PATTERN.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12;
}

function normalizedMoney(pattern: RegExp, positive: boolean) {
  return z
    .string()
    .trim()
    .regex(pattern, "Geçerli bir tutar girin.")
    .refine((value) => {
      const amount = new Decimal(value);
      return (
        amount.abs().lessThanOrEqualTo(MAX_MONEY) &&
        (!positive || amount.greaterThan(0))
      );
    }, "Tutar desteklenen aralıkta olmalıdır.")
    .transform((value) => new Decimal(value).toFixed(4));
}

const canonicalUuidSchema = z.string().regex(CANONICAL_UUID_PATTERN);
const isoDateSchema = z
  .string()
  .refine(isRealIsoDate, "Geçerli bir tarih girin.");
const monthSchema = z
  .string()
  .refine(isRealMonth, "Geçerli bir dönem ayı girin.");
const nullableTextSchema = (maximum: number, minimum = 1) =>
  z.preprocess(
    emptyToNull,
    z.union([z.string().trim().min(minimum).max(maximum), z.null()]),
  );
const nullableDateSchema = z.preprocess(
  emptyToNull,
  z.union([isoDateSchema, z.null()]),
);

export const taxTypeSchema = z.enum([
  "vat",
  "income_tax",
  "provisional_tax",
]);
export const taxStatusSchema = z.enum(["planned", "paid", "voided"]);

const editableCommonFields = {
  description: z.string().trim().min(1).max(191),
  dueOn: isoDateSchema,
  note: nullableTextSchema(2000).default(null),
  paidOn: nullableDateSchema.default(null),
  periodMonth: monthSchema,
  status: taxStatusSchema.default("planned"),
  voidReason: nullableTextSchema(2000, 3).default(null),
} as const;

function validateState(
  value: Readonly<{
    paidOn: string | null;
    status: "paid" | "planned" | "voided";
    voidReason: string | null;
  }>,
  context: z.RefinementCtx,
): void {
  if (value.status === "paid" && value.paidOn === null) {
    context.addIssue({
      code: "custom",
      message: "Ödenmiş vergi için ödeme tarihi gereklidir.",
      path: ["paidOn"],
    });
  }
  if (value.status !== "paid" && value.paidOn !== null) {
    context.addIssue({
      code: "custom",
      message: "Ödeme tarihi yalnız ödenmiş vergide kullanılabilir.",
      path: ["paidOn"],
    });
  }
  if (value.status === "voided" && value.voidReason === null) {
    context.addIssue({
      code: "custom",
      message: "İptal edilen vergi kaydı için gerekçe gereklidir.",
      path: ["voidReason"],
    });
  }
  if (value.status !== "voided" && value.voidReason !== null) {
    context.addIssue({
      code: "custom",
      message: "İptal gerekçesi yalnız iptal edilen kayıtta kullanılabilir.",
      path: ["voidReason"],
    });
  }
}

const vatFields = {
  carriedVatCreditAmount: normalizedMoney(
    UNSIGNED_MONEY_PATTERN,
    false,
  ).default("0.0000"),
  manualAdjustmentAmount: normalizedMoney(
    SIGNED_MONEY_PATTERN,
    false,
  ).default("0.0000"),
  taxType: z.literal("vat"),
} as const;

const accountantTaxFields = {
  accountantAmount: normalizedMoney(UNSIGNED_MONEY_PATTERN, true),
} as const;

const createVatInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    ...editableCommonFields,
    ...vatFields,
  })
  .strict()
  .superRefine(validateState);

const createIncomeTaxInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    ...editableCommonFields,
    ...accountantTaxFields,
    taxType: z.literal("income_tax"),
  })
  .strict()
  .superRefine(validateState);

const createProvisionalTaxInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    ...editableCommonFields,
    ...accountantTaxFields,
    taxType: z.literal("provisional_tax"),
  })
  .strict()
  .superRefine(validateState);

export const createTaxObligationInputSchema = z.union([
  createVatInputSchema,
  createIncomeTaxInputSchema,
  createProvisionalTaxInputSchema,
]);

const updateBase = {
  ...editableCommonFields,
  version: z.number().int().min(1).max(4_294_967_294),
} as const;

const updateVatInputSchema = z
  .object({ ...updateBase, ...vatFields })
  .strict()
  .superRefine(validateState);
const updateIncomeTaxInputSchema = z
  .object({
    ...updateBase,
    ...accountantTaxFields,
    taxType: z.literal("income_tax"),
  })
  .strict()
  .superRefine(validateState);
const updateProvisionalTaxInputSchema = z
  .object({
    ...updateBase,
    ...accountantTaxFields,
    taxType: z.literal("provisional_tax"),
  })
  .strict()
  .superRefine(validateState);

export const updateTaxObligationInputSchema = z.union([
  updateVatInputSchema,
  updateIncomeTaxInputSchema,
  updateProvisionalTaxInputSchema,
]);

export const taxListFilterSchema = z
  .object({ periodMonth: monthSchema.optional() })
  .strict();

export type CreateTaxObligationInput = z.infer<
  typeof createTaxObligationInputSchema
>;
export type UpdateTaxObligationInput = z.infer<
  typeof updateTaxObligationInputSchema
>;
export type TaxListFilter = z.infer<typeof taxListFilterSchema>;
export type TaxType = z.infer<typeof taxTypeSchema>;
export type TaxStatus = z.infer<typeof taxStatusSchema>;
