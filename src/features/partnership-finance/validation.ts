import Decimal from "decimal.js";
import { z } from "zod";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;
const MAX_MONEY = new Decimal("999999999999999.9999");

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isRealDate(value: string): boolean {
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
  return MONTH_PATTERN.test(value) && Number(value.slice(5)) >= 1 && Number(value.slice(5)) <= 12;
}

const uuidSchema = z.string().regex(UUID_PATTERN);
const dateSchema = z.string().refine(isRealDate);
const monthSchema = z.string().refine(isRealMonth);
const nullableDateSchema = z.preprocess(
  emptyToNull,
  z.union([dateSchema, z.null()]),
);
const nullableTextSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().min(1).max(2000), z.null()]),
);
const positiveMoneySchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, "Geçerli bir tutar girin.")
  .refine((value) => {
    const money = new Decimal(value);
    return money.greaterThan(0) && money.lessThanOrEqualTo(MAX_MONEY);
  })
  .transform((value) => new Decimal(value).toFixed(4));

export const commissionTransactionTypeSchema = z.enum(["sale", "rental"]);
export const commissionContributionModeSchema = z.enum([
  "partner_only",
  "user_one_side",
  "user_both",
]);
export const commissionStatusSchema = z.enum([
  "expected",
  "agency_collected",
  "paid",
  "cancelled",
]);
export const contributionStatusSchema = z.enum([
  "expected",
  "partial",
  "received",
  "cancelled",
]);

const commissionShape = {
  agencyCollectedOn: nullableDateSchema,
  closedOn: dateSchema,
  commissionBasisAmount: positiveMoneySchema,
  contributionMode: commissionContributionModeSchema,
  description: z.string().trim().min(1).max(191),
  note: nullableTextSchema,
  paidOn: nullableDateSchema,
  projectId: uuidSchema,
  status: commissionStatusSchema,
  transactionType: commissionTransactionTypeSchema,
};

function validateCommissionDates(
  value: Readonly<{
    agencyCollectedOn: string | null;
    closedOn: string;
    paidOn: string | null;
    status: z.infer<typeof commissionStatusSchema>;
  }>,
  context: z.RefinementCtx,
): void {
  const add = (path: "agencyCollectedOn" | "paidOn", message: string) =>
    context.addIssue({ code: "custom", message, path: [path] });
  if (value.status === "expected" || value.status === "cancelled") {
    if (value.agencyCollectedOn !== null) add("agencyCollectedOn", "Bu durumda ajans tahsil tarihi boş olmalıdır.");
    if (value.paidOn !== null) add("paidOn", "Bu durumda ödeme tarihi boş olmalıdır.");
    return;
  }
  if (value.agencyCollectedOn === null) {
    add("agencyCollectedOn", "Ajans tahsil tarihi zorunludur.");
  } else if (value.agencyCollectedOn < value.closedOn) {
    add("agencyCollectedOn", "Ajans tahsil tarihi işlem tarihinden önce olamaz.");
  }
  if (value.status === "agency_collected" && value.paidOn !== null) {
    add("paidOn", "Pay ödenmediyse ödeme tarihi boş olmalıdır.");
  }
  if (value.status === "paid") {
    if (value.paidOn === null) {
      add("paidOn", "Ödeme tarihi zorunludur.");
    } else if (
      value.agencyCollectedOn !== null &&
      value.paidOn < value.agencyCollectedOn
    ) {
      add("paidOn", "Ödeme tarihi ajans tahsil tarihinden önce olamaz.");
    }
  }
}

export const createCommissionInputSchema = z
  .object({
    ...commissionShape,
    agencyCollectedOn: nullableDateSchema.default(null),
    clientOperationKey: uuidSchema,
    note: nullableTextSchema.default(null),
    paidOn: nullableDateSchema.default(null),
    status: commissionStatusSchema.default("expected"),
  })
  .strict()
  .superRefine(validateCommissionDates);

export const updateCommissionInputSchema = z
  .object({
    ...commissionShape,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .superRefine(validateCommissionDates);

const contributionShape = {
  contributionMonth: monthSchema,
  description: z.string().trim().min(1).max(191),
  dueOn: dateSchema,
  expectedAmount: positiveMoneySchema,
  note: nullableTextSchema,
  projectId: uuidSchema,
};

function validateContributionPeriod(
  value: Readonly<{
    contributionMonth: string;
    dueOn: string;
  }>,
  context: z.RefinementCtx,
): void {
  if (value.dueOn < `${value.contributionMonth}-01`) {
    context.addIssue({ code: "custom", message: "Vade tarihi katkı döneminden önce olamaz.", path: ["dueOn"] });
  }
}

export const createContributionInputSchema = z
  .object({
    ...contributionShape,
    clientOperationKey: uuidSchema,
    note: nullableTextSchema.default(null),
    status: z.literal("expected").default("expected"),
  })
  .strict()
  .superRefine(validateContributionPeriod);

export const updateContributionInputSchema = z
  .object({
    ...contributionShape,
    status: contributionStatusSchema,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .superRefine(validateContributionPeriod);

export const createContributionReceiptInputSchema = z
  .object({
    amount: positiveMoneySchema,
    clientOperationKey: uuidSchema,
    note: nullableTextSchema.default(null),
    receivedOn: dateSchema,
  })
  .strict();

export const partnershipListFilterSchema = z
  .object({
    month: monthSchema.optional(),
    projectId: uuidSchema.optional(),
  })
  .strict();

export type CreateCommissionInput = z.input<typeof createCommissionInputSchema>;
export type UpdateCommissionInput = z.input<typeof updateCommissionInputSchema>;
export type CreateContributionInput = z.input<typeof createContributionInputSchema>;
export type UpdateContributionInput = z.input<typeof updateContributionInputSchema>;
export type CreateContributionReceiptInput = z.input<typeof createContributionReceiptInputSchema>;
export type PartnershipListFilter = z.infer<typeof partnershipListFilterSchema>;
