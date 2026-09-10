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
  "cancelled",
]);
const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const taskRecurrenceFrequencySchema = z.enum([
  "daily",
  "weekly",
  "monthly",
]);
const optionalUuidSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().regex(CANONICAL_UUID_PATTERN), z.null()]),
);
const optionalDateSchema = z.preprocess(
  emptyToNull,
  z.union([z.string().refine(isRealIsoDate), z.null()]),
);

function recurrenceIssue(
  context: z.RefinementCtx,
  message: string,
  path: string,
): void {
  context.addIssue({
    code: "custom",
    message,
    path: [path],
  });
}

export const taskRecurrenceStateSchema = z
  .object({
    dueOn: z.union([z.string().refine(isRealIsoDate), z.null()]),
    recurrenceEndsOn: z.union([z.string().refine(isRealIsoDate), z.null()]),
    recurrenceFrequency: z.union([taskRecurrenceFrequencySchema, z.null()]),
  })
  .strict()
  .superRefine(validateRecurrenceState);

function validateRecurrenceState(
  value: Readonly<{
    dueOn: string | null;
    recurrenceEndsOn: string | null;
    recurrenceFrequency: z.infer<typeof taskRecurrenceFrequencySchema> | null;
  }>,
  context: z.RefinementCtx,
): void {
  if (value.recurrenceFrequency === null) {
    if (value.recurrenceEndsOn !== null) {
      recurrenceIssue(
        context,
        "A recurrence end date requires a recurrence frequency.",
        "recurrenceEndsOn",
      );
    }
    return;
  }
  if (value.dueOn === null) {
    recurrenceIssue(
      context,
      "A recurring task requires a due date.",
      "dueOn",
    );
    return;
  }
  if (
    value.recurrenceEndsOn !== null &&
    value.recurrenceEndsOn < value.dueOn
  ) {
    recurrenceIssue(
      context,
      "A recurrence end date cannot precede the due date.",
      "recurrenceEndsOn",
    );
  }
}

export const createTaskInputSchema = z
  .object({
    assigneeUserAccountId: optionalUuidSchema.optional(),
    customerId: optionalUuidSchema.default(null),
    description: taskDescriptionSchema.default(null),
    dueOn: optionalDateSchema.default(null),
    priority: taskPrioritySchema.default("normal"),
    projectId: optionalUuidSchema.default(null),
    recurrenceEndsOn: optionalDateSchema.default(null),
    recurrenceFrequency: z
      .union([taskRecurrenceFrequencySchema, z.null()])
      .default(null),
    status: taskStatusSchema.default("backlog"),
    title: taskTitleSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateRecurrenceState(
      {
        dueOn: value.dueOn,
        recurrenceEndsOn: value.recurrenceEndsOn,
        recurrenceFrequency: value.recurrenceFrequency,
      },
      context,
    );
    if (
      value.recurrenceFrequency !== null &&
      (value.status === "done" || value.status === "cancelled")
    ) {
      recurrenceIssue(
        context,
        "A recurring task cannot start in a terminal status.",
        "status",
      );
    }
  });

export const updateTaskInputSchema = z
  .object({
    assigneeUserAccountId: optionalUuidSchema.optional(),
    customerId: optionalUuidSchema.optional(),
    description: taskDescriptionSchema.optional(),
    dueOn: optionalDateSchema.optional(),
    priority: taskPrioritySchema.optional(),
    projectId: optionalUuidSchema.optional(),
    recurrenceEndsOn: optionalDateSchema.optional(),
    recurrenceFrequency: z
      .union([taskRecurrenceFrequencySchema, z.null()])
      .optional(),
    status: taskStatusSchema.optional(),
    title: taskTitleSchema.optional(),
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "version"))
  .superRefine((value, context) => {
    if (
      value.recurrenceFrequency === null &&
      value.recurrenceEndsOn !== undefined &&
      value.recurrenceEndsOn !== null
    ) {
      recurrenceIssue(
        context,
        "A recurrence end date requires a recurrence frequency.",
        "recurrenceEndsOn",
      );
    }
    if (
      value.recurrenceFrequency !== undefined &&
      value.recurrenceFrequency !== null &&
      value.dueOn === null
    ) {
      recurrenceIssue(
        context,
        "A recurring task requires a due date.",
        "dueOn",
      );
    }
    if (
      typeof value.dueOn === "string" &&
      typeof value.recurrenceEndsOn === "string" &&
      value.recurrenceEndsOn < value.dueOn
    ) {
      recurrenceIssue(
        context,
        "A recurrence end date cannot precede the due date.",
        "recurrenceEndsOn",
      );
    }
  });

export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
