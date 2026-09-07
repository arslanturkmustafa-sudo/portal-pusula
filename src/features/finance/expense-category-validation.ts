import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const createExpenseCategoryInputSchema = z
  .object({
    clientOperationKey: z.string().regex(CANONICAL_UUID_PATTERN),
    displayName: z.string().trim().min(1).max(191),
  })
  .strict();

export type CreateExpenseCategoryInput = z.infer<
  typeof createExpenseCategoryInputSchema
>;
