import { z } from "zod";

export const updateNotificationSettingsInputSchema = z
  .object({
    recipientEmail: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email().max(254)),
  })
  .strict();

export type UpdateNotificationSettingsInput = z.infer<
  typeof updateNotificationSettingsInputSchema
>;
