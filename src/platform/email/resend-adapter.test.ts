// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EmailEnvironment } from "@/platform/config/email-env.schema";
import {
  EMAIL_OUTBOX_EVENT_TYPE,
  EMAIL_OUTBOX_SCHEMA_VERSION,
} from "@/platform/email/outbox-email";
import {
  createResendEmailOutboxAdapter,
  EmailDeliveryError,
} from "@/platform/email/resend-adapter";
import type {
  OutboxAdapter,
  OutboxDelivery,
} from "@/platform/outbox/dispatcher";

type FetchEmail = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const recipientAccountId = "123e4567-e89b-42d3-a456-426614174000";

const enabledEnvironment = {
  apiKey: `re_${"A".repeat(32)}`,
  enabled: true,
  fromAddress: "bildirim@muhendiskafasi.com.tr",
  fromName: "Portal Pusula",
} satisfies EmailEnvironment;

function delivery(
  overrides: Partial<OutboxDelivery> = {},
): OutboxDelivery {
  return {
    eventType: EMAIL_OUTBOX_EVENT_TYPE,
    idempotencyKey: "email:daily-owner-digest:2099-01-02",
    payload: {
      html: "<p>Günlük özet</p>",
      recipientAccountId,
      subject: "Günlük özet",
      text: "Günlük özet",
    },
    schemaVersion: EMAIL_OUTBOX_SCHEMA_VERSION,
    ...overrides,
  };
}

function deliver(
  adapter: OutboxAdapter,
  item: OutboxDelivery,
  signal?: AbortSignal,
): Promise<void> {
  const deliverWithSignal = adapter.deliver as (
    input: OutboxDelivery,
    parentSignal?: AbortSignal,
  ) => Promise<void>;
  return deliverWithSignal(item, signal);
}

async function caughtError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Resend email outbox adapter", () => {
  it("rejects mismatched event metadata before resolving configuration", async () => {
    const getEnvironment = vi.fn(() => enabledEnvironment);
    const findRecipient = vi.fn(async () => ({
      email: "owner@example.com",
      id: recipientAccountId,
    }));
    const fetchEmail = vi.fn<FetchEmail>();
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient,
      getEnvironment,
    });

    const error = await caughtError(
      deliver(
        adapter,
        delivery({ eventType: "email.unknown", schemaVersion: 999 }),
      ),
    );

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(String(error)).toBe(
      "EmailDeliveryError: Email delivery failed safely.",
    );
    expect(getEnvironment).not.toHaveBeenCalled();
    expect(findRecipient).not.toHaveBeenCalled();
    expect(fetchEmail).not.toHaveBeenCalled();
  });

  it("does nothing when email notifications are disabled", async () => {
    const findRecipient = vi.fn();
    const fetchEmail = vi.fn<FetchEmail>();
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient,
      getEnvironment: () => ({ enabled: false }),
    });

    await expect(
      deliver(
        adapter,
        delivery({ payload: { secret: "disabled-payload-sentinel" } }),
      ),
    ).resolves.toBeUndefined();
    expect(findRecipient).not.toHaveBeenCalled();
    expect(fetchEmail).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads without resolving or exposing a recipient", async () => {
    const payloadSentinel = "malformed-email-payload-sentinel";
    const findRecipient = vi.fn();
    const fetchEmail = vi.fn<FetchEmail>();
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient,
      getEnvironment: () => enabledEnvironment,
    });

    const error = await caughtError(
      deliver(
        adapter,
        delivery({
          payload: {
            html: `<p>${payloadSentinel}</p>`,
            recipientAccountId: "not-a-uuid",
            subject: "Invalid payload",
            text: payloadSentinel,
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(String(error)).not.toContain(payloadSentinel);
    expect(JSON.stringify(error)).not.toContain(payloadSentinel);
    expect(findRecipient).not.toHaveBeenCalled();
    expect(fetchEmail).not.toHaveBeenCalled();
  });

  it("suppresses delivery when the intended owner is no longer active", async () => {
    const findRecipient = vi.fn(async () => null);
    const fetchEmail = vi.fn<FetchEmail>();
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient,
      getEnvironment: () => enabledEnvironment,
    });

    await expect(deliver(adapter, delivery())).resolves.toBeUndefined();

    expect(findRecipient).toHaveBeenCalledWith(recipientAccountId);
    expect(fetchEmail).not.toHaveBeenCalled();
  });

  it("sends one idempotent no-store request to the fixed Resend endpoint", async () => {
    const recipientEmail = "owner@example.com";
    const findRecipient = vi.fn(async () => ({
      email: recipientEmail,
      id: recipientAccountId,
    }));
    const fetchEmail = vi
      .fn<FetchEmail>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient,
      getEnvironment: () => enabledEnvironment,
    });
    const item = delivery();

    await expect(deliver(adapter, item)).resolves.toBeUndefined();

    expect(fetchEmail).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchEmail.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${enabledEnvironment.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": item.idempotencyKey,
      },
      method: "POST",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "Portal Pusula <bildirim@muhendiskafasi.com.tr>",
      html: "<p>Günlük özet</p>",
      subject: "Günlük özet",
      text: "Günlük özet",
      to: [recipientEmail],
    });
  });

  it("does not read or expose a rejected provider response", async () => {
    const responseBodySentinel = "provider-response-body-sentinel";
    const readResponseBody = vi.fn(async () => responseBodySentinel);
    const fetchEmail = vi.fn<FetchEmail>().mockResolvedValue({
      ok: false,
      text: readResponseBody,
    } as unknown as Response);
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient: async () => ({
        email: "provider-rejection@example.com",
        id: recipientAccountId,
      }),
      getEnvironment: () => enabledEnvironment,
    });

    const error = await caughtError(deliver(adapter, delivery()));

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(String(error)).not.toContain(responseBodySentinel);
    expect(JSON.stringify(error)).not.toContain(responseBodySentinel);
    expect(readResponseBody).not.toHaveBeenCalled();
  });

  it("replaces raw network failures with a generic delivery error", async () => {
    const networkSentinel = "network-error-and-recipient-sentinel@example.com";
    const fetchEmail = vi
      .fn<FetchEmail>()
      .mockRejectedValue(new Error(networkSentinel));
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient: async () => ({
        email: "network-recipient@example.com",
        id: recipientAccountId,
      }),
      getEnvironment: () => enabledEnvironment,
    });

    const error = await caughtError(deliver(adapter, delivery()));

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(String(error)).toBe(
      "EmailDeliveryError: Email delivery failed safely.",
    );
    expect(String(error)).not.toContain(networkSentinel);
    expect(JSON.stringify(error)).not.toContain(networkSentinel);
  });

  it("aborts a stalled provider request within the configured timeout", async () => {
    vi.useFakeTimers();
    const timeoutSentinel = "timeout-provider-error-sentinel";
    let providerSignal: AbortSignal | undefined;
    const fetchEmail = vi.fn<FetchEmail>((_input, init) => {
      providerSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(new Error(timeoutSentinel));
        if (providerSignal?.aborted) rejectOnAbort();
        else providerSignal?.addEventListener("abort", rejectOnAbort, {
          once: true,
        });
      });
    });
    const adapter = createResendEmailOutboxAdapter({
      fetchEmail,
      findRecipient: async () => ({
        email: "timeout-recipient@example.com",
        id: recipientAccountId,
      }),
      getEnvironment: () => enabledEnvironment,
      timeoutMs: 25,
    });

    const outcome = caughtError(deliver(adapter, delivery()));
    await vi.advanceTimersByTimeAsync(25);
    const error = await outcome;

    expect(providerSignal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(String(error)).not.toContain(timeoutSentinel);
    expect(JSON.stringify(error)).not.toContain(timeoutSentinel);
    expect(vi.getTimerCount()).toBe(0);
  });
});
