import "server-only";

import type { Pool } from "mysql2/promise";

import { findActiveOwnerEmailRecipientById } from "@/features/account/repository";
import { getEmailEnvironment } from "@/platform/config/email-env";
import type { EmailEnvironment } from "@/platform/config/email-env.schema";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { withUtcConsistentRead } from "@/platform/jobs/mysql-transaction";
import type { OutboxAdapter } from "@/platform/outbox/dispatcher";
import {
  EMAIL_OUTBOX_EVENT_TYPE,
  EMAIL_OUTBOX_SCHEMA_VERSION,
  emailOutboxPayloadSchema,
} from "@/platform/email/outbox-email";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_DELIVERY_TIMEOUT_MS = 1_000;

export class EmailDeliveryError extends Error {
  constructor() {
    super("Email delivery failed safely.");
    this.name = "EmailDeliveryError";
  }
}

type FetchEmail = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type Recipient = Readonly<{
  email: string;
  id: string;
}>;

type ResendAdapterDependencies = Readonly<{
  fetchEmail?: FetchEmail;
  findRecipient?: (accountId: string) => Promise<Recipient | null>;
  getEnvironment?: () => EmailEnvironment;
  timeoutMs?: number;
}>;

async function findProductionRecipient(
  accountId: string,
): Promise<Recipient | null> {
  const pool: Pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
  return withUtcConsistentRead(pool, (connection) =>
    findActiveOwnerEmailRecipientById(connection, accountId),
  );
}

function linkedAbortSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Readonly<{ dispose: () => void; signal: AbortSignal }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  return {
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

export function createResendEmailOutboxAdapter(
  dependencies: ResendAdapterDependencies = {},
): OutboxAdapter {
  const fetchEmail = dependencies.fetchEmail ?? fetch;
  const findRecipient =
    dependencies.findRecipient ?? findProductionRecipient;
  const getEnvironment =
    dependencies.getEnvironment ?? getEmailEnvironment;
  const timeoutMs = dependencies.timeoutMs ?? EMAIL_DELIVERY_TIMEOUT_MS;

  return {
    async deliver(delivery, parentSignal) {
      if (
        delivery.eventType !== EMAIL_OUTBOX_EVENT_TYPE ||
        delivery.schemaVersion !== EMAIL_OUTBOX_SCHEMA_VERSION
      ) {
        throw new EmailDeliveryError();
      }

      const environment = getEnvironment();
      if (!environment.enabled) return;

      const parsed = emailOutboxPayloadSchema.safeParse(delivery.payload);
      if (!parsed.success) throw new EmailDeliveryError();
      const recipient = await findRecipient(parsed.data.recipientAccountId);
      if (recipient === null) return;

      const linkedSignal = linkedAbortSignal(parentSignal, timeoutMs);
      try {
        const response = await fetchEmail(RESEND_EMAIL_ENDPOINT, {
          body: JSON.stringify({
            from: `${environment.fromName} <${environment.fromAddress}>`,
            html: parsed.data.html,
            subject: parsed.data.subject,
            text: parsed.data.text,
            to: [recipient.email],
          }),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${environment.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": delivery.idempotencyKey,
          },
          method: "POST",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: linkedSignal.signal,
        });
        if (!response.ok) throw new EmailDeliveryError();
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        throw new EmailDeliveryError();
      } finally {
        linkedSignal.dispose();
      }
    },
  };
}
