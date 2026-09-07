import { z } from "zod";

const lifecycleReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional();

export const lifecycleCommandInputSchema = z
  .object({
    action: z.enum(["archive", "restore"]),
    reason: lifecycleReasonSchema,
    version: z.number().int().min(1).max(4_294_967_294),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "archive" && value.reason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Arşivleme gerekçesi zorunludur.",
        path: ["reason"],
      });
    }
  });

export type LifecycleCommandInput = z.infer<
  typeof lifecycleCommandInputSchema
>;
