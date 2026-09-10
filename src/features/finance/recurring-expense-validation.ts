import Decimal from "decimal.js";
import { z } from "zod";

import {
  expenseCategorySchema,
  expensePaymentMethodSchema,
} from "@/features/finance/spending-validation";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_MONEY = new Decimal("999999999999999.9999");

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

const canonicalUuidSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, "Geçerli bir kayıt seçin.");
const nullableUuidSchema = z.preprocess(
  emptyToNull,
  z.union([canonicalUuidSchema, z.null()]),
);
const nullableTextSchema = (maximum: number) =>
  z.preprocess(
    emptyToNull,
    z.union([z.string().trim().min(1).max(maximum), z.null()]),
  );
const isoDateSchema = z
  .string()
  .refine(isRealIsoDate, "Geçerli bir tarih girin.");
const nullableIsoDateSchema = z.preprocess(
  emptyToNull,
  z.union([isoDateSchema, z.null()]),
);
const moneySchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, "Geçerli bir tutar girin.")
  .refine((value) => new Decimal(value).greaterThanOrEqualTo(0))
  .transform((value) => new Decimal(value).toFixed(4));

export const recurringExpenseFrequencySchema = z.enum(["weekly", "monthly"]);
export const recurringExpenseStatusSchema = z.enum(["active", "paused"]);

const planFields = {
  category: expenseCategorySchema,
  creditCardId: nullableUuidSchema.default(null),
  description: z.string().trim().min(1).max(191),
  endsOn: nullableIsoDateSchema.default(null),
  frequency: recurringExpenseFrequencySchema,
  netAmount: moneySchema,
  note: nullableTextSchema(2000).default(null),
  paymentMethod: expensePaymentMethodSchema,
  projectId: nullableUuidSchema.default(null),
  sourceAccountId: nullableUuidSchema.default(null),
  vatAmount: moneySchema.default("0.0000"),
  vendorName: nullableTextSchema(191).default(null),
} as const;

function validatePlanShape(
  value: Readonly<{
    creditCardId: string | null;
    dueOn: string;
    endsOn: string | null;
    netAmount: string;
    paymentMethod: z.infer<typeof expensePaymentMethodSchema>;
    sourceAccountId: string | null;
    status?: z.infer<typeof recurringExpenseStatusSchema>;
    vatAmount: string;
  }>,
  context: z.RefinementCtx,
): void {
  const total = new Decimal(value.netAmount).plus(value.vatAmount);
  if (total.lessThanOrEqualTo(0)) {
    context.addIssue({
      code: "custom",
      message: "Toplam gider sıfırdan büyük olmalıdır.",
      path: ["netAmount"],
    });
  }
  if (total.greaterThan(MAX_MONEY)) {
    context.addIssue({
      code: "custom",
      message: "Toplam gider desteklenen sınırı aşıyor.",
      path: ["netAmount"],
    });
  }

  const usesCard = value.paymentMethod === "credit_card";
  if (usesCard !== (value.creditCardId !== null)) {
    context.addIssue({
      code: "custom",
      message: "Kredi kartı planında kart seçimi zorunludur.",
      path: ["creditCardId"],
    });
  }
  const usesDirectAccount =
    value.paymentMethod === "cash" || value.paymentMethod === "bank_transfer";
  if (usesDirectAccount !== (value.sourceAccountId !== null)) {
    context.addIssue({
      code: "custom",
      message: "Nakit veya banka planında kaynak hesap seçimi zorunludur.",
      path: ["sourceAccountId"],
    });
  }
  if (
    value.status !== "paused" &&
    value.endsOn !== null &&
    value.endsOn < value.dueOn
  ) {
    context.addIssue({
      code: "custom",
      message: "Bitiş tarihi ilk veya sıradaki vadeden önce olamaz.",
      path: ["endsOn"],
    });
  }
}

export const createRecurringExpenseInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    firstDueOn: isoDateSchema,
    ...planFields,
  })
  .strict()
  .superRefine((value, context) =>
    validatePlanShape({ ...value, dueOn: value.firstDueOn }, context),
  );

export const updateRecurringExpenseInputSchema = z
  .object({
    nextDueOn: isoDateSchema,
    status: recurringExpenseStatusSchema,
    version: z.number().int().min(1).max(4_294_967_294),
    ...planFields,
  })
  .strict()
  .superRefine((value, context) =>
    validatePlanShape({ ...value, dueOn: value.nextDueOn }, context),
  );

export const realizeRecurringExpenseInputSchema = z
  .object({
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict();

export type CreateRecurringExpenseInput = z.infer<
  typeof createRecurringExpenseInputSchema
>;
export type UpdateRecurringExpenseInput = z.infer<
  typeof updateRecurringExpenseInputSchema
>;
export type RealizeRecurringExpenseInput = z.infer<
  typeof realizeRecurringExpenseInputSchema
>;
export type RecurringExpenseFrequency = z.infer<
  typeof recurringExpenseFrequencySchema
>;
export type RecurringExpenseStatus = z.infer<
  typeof recurringExpenseStatusSchema
>;
