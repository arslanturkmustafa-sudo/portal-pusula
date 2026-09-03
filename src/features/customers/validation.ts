import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const displayNameSchema = z.string().trim().min(1).max(191);
const shortCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u);
const statusSchema = z.enum(["active", "inactive"]);
const projectIdsSchema = z
  .array(
    z
      .string()
      .regex(CANONICAL_UUID_PATTERN, "Geçerli bir proje seçin."),
  )
  .min(1, "En az bir proje seçin.")
  .max(100)
  .superRefine((projectIds, context) => {
    const seen = new Set<string>();
    for (const [index, projectId] of projectIds.entries()) {
      if (seen.has(projectId)) {
        context.addIssue({
          code: "custom",
          message: "Aynı proje birden fazla seçilemez.",
          path: [index],
        });
      }
      seen.add(projectId);
    }
  });

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
    projectIds: projectIdsSchema,
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
    projectIds: projectIdsSchema.optional(),
    shortCode: shortCodeSchema.optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;
