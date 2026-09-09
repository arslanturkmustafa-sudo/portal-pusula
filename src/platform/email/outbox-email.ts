import "server-only";

import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";

import { enqueueOutboxEvent } from "@/platform/outbox/repository";

export const EMAIL_OUTBOX_EVENT_TYPE = "email.send.v1";
export const EMAIL_OUTBOX_SCHEMA_VERSION = 1;

const messageSubjectSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim() && !/[\r\n]/u.test(value));

export const emailOutboxPayloadSchema = z
  .object({
    html: z.string().min(1).max(100_000),
    recipientAccountId: z.uuid(),
    subject: messageSubjectSchema,
    text: z.string().min(1).max(50_000),
  })
  .strict();

export type EmailOutboxPayload = z.infer<typeof emailOutboxPayloadSchema>;

export type EmailMessage = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

export async function enqueueEmailDelivery(
  connection: PoolConnection,
  input: Readonly<{
    availableAtUtc: string;
    idempotencyKey: string;
    message: EmailMessage;
    recipientAccountId: string;
  }>,
): Promise<void> {
  const payload = emailOutboxPayloadSchema.parse({
    ...input.message,
    recipientAccountId: input.recipientAccountId,
  });
  await enqueueOutboxEvent(connection, {
    availableAtUtc: input.availableAtUtc,
    eventType: EMAIL_OUTBOX_EVENT_TYPE,
    idempotencyKey: input.idempotencyKey,
    maxAttempts: 5,
    payload,
    schemaVersion: EMAIL_OUTBOX_SCHEMA_VERSION,
  });
}
