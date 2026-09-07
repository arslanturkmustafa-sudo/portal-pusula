import Decimal from "decimal.js";
import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const POSITIVE_MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
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

const canonicalUuidSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, "Geçerli bir kayıt seçin.");
const nullableUuidSchema = z.preprocess(
  emptyToNull,
  z.union([canonicalUuidSchema, z.null()]),
);
const optionalBankNameSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().trim().min(1).max(191), z.null()]),
);

export const financeAccountTypeSchema = z.enum(["cash", "bank"]);
export const financeAccountStatusSchema = z.enum(["active", "inactive"]);
export const financeTransactionTypeSchema = z.enum([
  "income",
  "expense",
  "transfer",
]);

const editableAccountFields = {
  bankName: optionalBankNameSchema.default(null),
  displayName: z.string().trim().min(1).max(191),
  status: financeAccountStatusSchema.default("active"),
} as const;

function validateAccountShape(
  value: Readonly<{ accountType: "cash" | "bank"; bankName: string | null }>,
  context: z.RefinementCtx,
): void {
  if (value.accountType === "cash" && value.bankName !== null) {
    context.addIssue({
      code: "custom",
      message: "Kasa hesabında banka adı kullanılamaz.",
      path: ["bankName"],
    });
  }
}

export const createFinanceAccountInputSchema = z
  .object({
    accountType: financeAccountTypeSchema,
    clientOperationKey: canonicalUuidSchema,
    ...editableAccountFields,
    openingBalanceAmount: normalizedMoney(SIGNED_MONEY_PATTERN, false),
  })
  .strict()
  .superRefine(validateAccountShape);

export const updateFinanceAccountInputSchema = z
  .object({
    accountType: financeAccountTypeSchema,
    ...editableAccountFields,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .superRefine(validateAccountShape);

export const createFinanceTransactionInputSchema = z
  .object({
    amount: normalizedMoney(POSITIVE_MONEY_PATTERN, true),
    clientOperationKey: canonicalUuidSchema,
    description: z.string().trim().min(1).max(191),
    occurredOn: z
      .string()
      .refine(isRealIsoDate, "Geçerli bir tarih girin."),
    sourceAccountId: nullableUuidSchema.default(null),
    targetAccountId: nullableUuidSchema.default(null),
    transactionType: financeTransactionTypeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const source = value.sourceAccountId;
    const target = value.targetAccountId;
    const valid =
      (value.transactionType === "income" && source === null && target !== null) ||
      (value.transactionType === "expense" && source !== null && target === null) ||
      (value.transactionType === "transfer" &&
        source !== null &&
        target !== null &&
        source !== target);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Hareket türü ile kaynak ve hedef hesaplar uyumlu olmalıdır.",
        path: ["transactionType"],
      });
    }
  });

export const reverseFinanceTransactionInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export type CreateFinanceAccountInput = z.infer<
  typeof createFinanceAccountInputSchema
>;
export type UpdateFinanceAccountInput = z.infer<
  typeof updateFinanceAccountInputSchema
>;
export type CreateFinanceTransactionInput = z.infer<
  typeof createFinanceTransactionInputSchema
>;
export type ReverseFinanceTransactionInput = z.infer<
  typeof reverseFinanceTransactionInputSchema
>;
