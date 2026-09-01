import { z } from "zod";

export const passwordChangeInputSchema = z
  .object({
    confirmation: z.string().min(8).max(256),
    currentPassword: z.string().min(1).max(256).optional(),
    newPassword: z.string().min(8).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmation) {
      context.addIssue({
        code: "custom",
        message: "Parola tekrarı eşleşmiyor.",
        path: ["confirmation"],
      });
    }
    if (
      value.currentPassword !== undefined &&
      value.currentPassword === value.newPassword
    ) {
      context.addIssue({
        code: "custom",
        message: "Yeni parola mevcut paroladan farklı olmalıdır.",
        path: ["newPassword"],
      });
    }
  });

export type PasswordChangeInput = z.infer<typeof passwordChangeInputSchema>;
