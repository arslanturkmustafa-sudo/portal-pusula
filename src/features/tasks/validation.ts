import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

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

const taskTitleSchema = z.string().trim().min(1).max(191);
const taskDescriptionSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().min(1).max(4000), z.null()]),
);
const taskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "done",
]);
const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const optionalUuidSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().regex(CANONICAL_UUID_PATTERN), z.null()]),
);
const optionalDateSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().refine(isRealIsoDate), z.null()]),
);

export const createTaskInputSchema = z
  .object({
    assigneeUserAccountId: optionalUuidSchema.optional(),
    customerId: optionalUuidSchema.default(null),
    description: taskDescriptionSchema.default(null),
    dueOn: optionalDateSchema.default(null),
    priority: taskPrioritySchema.default("normal"),
    status: taskStatusSchema.default("backlog"),
    title: taskTitleSchema,
  })
  .strict();

export const updateTaskInputSchema = z
  .object({
    assigneeUserAccountId: optionalUuidSchema.optional(),
    customerId: optionalUuidSchema.optional(),
    description: taskDescriptionSchema.optional(),
    dueOn: optionalDateSchema.optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
    title: taskTitleSchema.optional(),
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "version"));

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
