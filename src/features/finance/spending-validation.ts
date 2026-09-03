import Decimal from "decimal.js";
import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function moneySchema(positive: boolean) {
  return z
    .string()
    .trim()
    .regex(MONEY_PATTERN, "Geçerli bir tutar girin.")
    .refine((value) => {
      const amount = new Decimal(value);
      return positive ? amount.greaterThan(0) : amount.greaterThanOrEqualTo(0);
    })
    .transform((value) => new Decimal(value).toFixed(4));
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
    z.union([z.string().min(1).max(maximum), z.null()]),
  );
const isoDateSchema = z
  .string()
  .refine(isRealIsoDate, "Geçerli bir tarih girin.");
const nullableIsoDateSchema = z.preprocess(
  emptyToNull,
  z.union([isoDateSchema, z.null()]),
);
const nullablePositiveMoneySchema = z.preprocess(
  emptyToNull,
  z.union([moneySchema(true), z.null()]),
);

export const creditCardStatusSchema = z.enum(["active", "inactive"]);
export const expenseStatusSchema = z.enum(["active", "voided"]);
export const expenseCategorySchema = z.enum([
  "rent",
  "software_subscription",
  "transportation",
  "meals_hospitality",
  "marketing",
  "office",
  "external_service",
  "tax_fee",
  "other",
]);
export const expenseDocumentTypeSchema = z.enum([
  "none",
  "invoice",
  "receipt",
  "other",
]);
export const expensePaymentMethodSchema = z.enum([
  "cash",
  "bank_transfer",
  "credit_card",
  "other",
]);
export const installmentStoredStatusSchema = z.enum(["paid", "planned"]);

const cardFields = {
  bankName: nullableTextSchema(191).default(null),
  creditLimitAmount: nullablePositiveMoneySchema.default(null),
  displayName: z.string().trim().min(1).max(191),
  lastFour: z.preprocess(
    emptyToNull,
    z.union([z.string().regex(/^\d{4}$/u), z.null()]),
  ).default(null),
  note: nullableTextSchema(2000).default(null),
  paymentDueDay: z.number().int().min(1).max(31),
  statementClosingDay: z.number().int().min(1).max(31),
  status: creditCardStatusSchema.default("active"),
} as const;

export const createCreditCardInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    ...cardFields,
  })
  .strict();

export const updateCreditCardInputSchema = z
  .object({
    ...cardFields,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict();

const expenseFields = {
  category: expenseCategorySchema,
  creditCardId: nullableUuidSchema.default(null),
  description: z.string().trim().min(1).max(191),
  documentNumber: nullableTextSchema(64).default(null),
  documentType: expenseDocumentTypeSchema.default("none"),
  incurredOn: isoDateSchema,
  installmentCount: z.number().int().min(1).max(36).default(1),
  netAmount: moneySchema(false),
  note: nullableTextSchema(2000).default(null),
  paymentMethod: expensePaymentMethodSchema,
  projectId: nullableUuidSchema.default(null),
  vatAmount: moneySchema(false).default("0.0000"),
  vendorName: nullableTextSchema(191).default(null),
} as const;

function validateExpenseShape(
  value: Readonly<{
    creditCardId: string | null;
    documentNumber: string | null;
    documentType: z.infer<typeof expenseDocumentTypeSchema>;
    installmentCount: number;
    netAmount: string;
    paymentMethod: z.infer<typeof expensePaymentMethodSchema>;
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
  const isCard = value.paymentMethod === "credit_card";
  if (isCard !== (value.creditCardId !== null)) {
    context.addIssue({
      code: "custom",
      message: "Kredi kartı ödemesinde kart seçimi zorunludur.",
      path: ["creditCardId"],
    });
  }
  if (!isCard && value.installmentCount !== 1) {
    context.addIssue({
      code: "custom",
      message: "Taksit yalnız kredi kartı giderinde kullanılabilir.",
      path: ["installmentCount"],
    });
  }
  if (value.documentType === "none" && value.documentNumber !== null) {
    context.addIssue({
      code: "custom",
      message: "Belgesiz giderde belge numarası kullanılamaz.",
      path: ["documentNumber"],
    });
  }
}

export const createExpenseInputSchema = z
  .object({
    clientOperationKey: canonicalUuidSchema,
    ...expenseFields,
  })
  .strict()
  .superRefine(validateExpenseShape);

export const updateExpenseInputSchema = z
  .object({
    ...expenseFields,
    status: expenseStatusSchema,
    version: z.number().int().min(1).max(4_294_967_294),
    voidReason: nullableTextSchema(2000).default(null),
  })
  .strict()
  .superRefine((value, context) => {
    validateExpenseShape(value, context);
    if (value.status === "voided" && value.voidReason === null) {
      context.addIssue({
        code: "custom",
        message: "İptal nedeni zorunludur.",
        path: ["voidReason"],
      });
    }
    if (value.status === "active" && value.voidReason !== null) {
      context.addIssue({
        code: "custom",
        message: "Aktif giderde iptal nedeni kullanılamaz.",
        path: ["voidReason"],
      });
    }
  });

export const expenseListFilterSchema = z
  .object({
    category: expenseCategorySchema.optional(),
    month: z.string().refine(isRealMonth).optional(),
    paymentMethod: expensePaymentMethodSchema.optional(),
    projectId: canonicalUuidSchema.optional(),
  })
  .strict();

export const installmentListFilterSchema = z
  .object({
    cardId: canonicalUuidSchema.optional(),
    month: z.string().refine(isRealMonth).optional(),
  })
  .strict();

export const updateCardInstallmentInputSchema = z
  .object({
    paidOn: nullableIsoDateSchema.default(null),
    status: installmentStoredStatusSchema,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "paid" && value.paidOn === null) {
      context.addIssue({
        code: "custom",
        message: "Ödeme tarihi zorunludur.",
        path: ["paidOn"],
      });
    }
    if (value.status === "planned" && value.paidOn !== null) {
      context.addIssue({
        code: "custom",
        message: "Planlanan taksitte ödeme tarihi kullanılamaz.",
        path: ["paidOn"],
      });
    }
  });

export type CreateCreditCardInput = z.infer<
  typeof createCreditCardInputSchema
>;
export type UpdateCreditCardInput = z.infer<
  typeof updateCreditCardInputSchema
>;
export type CreateExpenseInput = z.infer<typeof createExpenseInputSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseInputSchema>;
export type ExpenseListFilter = z.infer<typeof expenseListFilterSchema>;
export type InstallmentListFilter = z.infer<
  typeof installmentListFilterSchema
>;
export type UpdateCardInstallmentInput = z.infer<
  typeof updateCardInstallmentInputSchema
>;
