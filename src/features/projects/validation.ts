import Decimal from "decimal.js";
import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;

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

const displayNameSchema = z.string().trim().min(1).max(191);
const shortCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u);
export const projectTypeSchema = z.enum([
  "consulting",
  "product",
  "partnership",
  "internal",
]);
export const projectStatusSchema = z.enum([
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
]);
const nullableTextSchema = (maximum: number) =>
  z.preprocess(
    emptyToNull,
    z.union([z.string().min(1).max(maximum), z.null()]),
  );
const nullableDateSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().refine(isRealIsoDate), z.null()]),
);
const nullableMoneySchema = z.preprocess(
  emptyToNull,
  z.union([
    z
      .string()
      .trim()
      .regex(MONEY_PATTERN)
      .refine((value) => new Decimal(value).greaterThanOrEqualTo(0))
      .transform((value) => new Decimal(value).toFixed(4)),
    z.null(),
  ]),
);

function validatePeriod(
  value: Readonly<{ startsOn: string | null; targetEndsOn: string | null }>,
  context: z.RefinementCtx,
): void {
  if (
    value.startsOn !== null &&
    value.targetEndsOn !== null &&
    value.targetEndsOn < value.startsOn
  ) {
    context.addIssue({
      code: "custom",
      message: "Hedef bitiş tarihi başlangıç tarihinden önce olamaz.",
      path: ["targetEndsOn"],
    });
  }
}

export const createProjectInputSchema = z
  .object({
    budgetAmount: nullableMoneySchema.default(null),
    displayName: displayNameSchema,
    internalNote: nullableTextSchema(2000).default(null),
    objective: nullableTextSchema(4000).default(null),
    projectType: projectTypeSchema,
    shortCode: shortCodeSchema,
    startsOn: nullableDateSchema.default(null),
    status: projectStatusSchema.default("active"),
    targetEndsOn: nullableDateSchema.default(null),
  })
  .strict()
  .superRefine(validatePeriod);

export const updateProjectInputSchema = z
  .object({
    budgetAmount: nullableMoneySchema,
    displayName: displayNameSchema,
    internalNote: nullableTextSchema(2000),
    objective: nullableTextSchema(4000),
    projectType: projectTypeSchema,
    shortCode: shortCodeSchema,
    startsOn: nullableDateSchema,
    status: projectStatusSchema,
    targetEndsOn: nullableDateSchema,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .superRefine(validatePeriod);

export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectInputSchema>;
