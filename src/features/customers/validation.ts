import { z } from "zod";

const displayNameSchema = z.string().trim().min(1).max(191);
const shortCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u);
const statusSchema = z.enum(["active", "inactive"]);

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const optionalNoteSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().min(1).max(2000), z.null()]).default(null),
);
const optionalEmailSchema = z.preprocess(
  emptyToNull,
  z
    .union([
      z.string().email().max(254).transform((value) => value.toLowerCase()),
      z.null(),
    ])
    .default(null),
);
const optionalPhoneSchema = z.preprocess(
  emptyToNull,
  z
    .union([
      z.string().min(3).max(32).regex(/^[0-9+() -]+$/u),
      z.null(),
    ])
    .default(null),
);

export const createCustomerInputSchema = z
  .object({
    contactNote: optionalNoteSchema,
    displayName: displayNameSchema,
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
    shortCode: shortCodeSchema,
    status: statusSchema.default("active"),
  })
  .strict();

export const updateCustomerInputSchema = z
  .object({
    contactNote: optionalNoteSchema.optional(),
    displayName: displayNameSchema.optional(),
    email: optionalEmailSchema.optional(),
    phone: optionalPhoneSchema.optional(),
    shortCode: shortCodeSchema.optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;
