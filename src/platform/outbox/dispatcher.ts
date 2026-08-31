import "server-only";

import type { Pool } from "mysql2/promise";

import type { BackoffPolicy } from "@/platform/jobs/backoff";
import type { Clock } from "@/platform/jobs/time";

import {
  claimOutboxEvents,
  completeOutboxDelivery,
  recordOutboxFailure,
  type ClaimedOutboxEvent,
} from "./repository";

export type OutboxDelivery = Readonly<{
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
  schemaVersion: number;
}>;

export type OutboxAdapter = Readonly<{
  deliver: (delivery: OutboxDelivery) => Promise<void>;
}>;

export type OutboxAdapterRegistry = ReadonlyMap<string, OutboxAdapter>;

/** Komut 3B deliberately configures no real external delivery adapter. */
export const productionOutboxAdapterRegistry: OutboxAdapterRegistry = new Map();

export type OutboxDispatchSummary = Readonly<{
  claimed: number;
  deadLettered: number;
  delivered: number;
  retried: number;
  stale: number;
}>;

async function deliverClaimedEvent(
  pool: Pool,
  event: ClaimedOutboxEvent,
  input: Readonly<{
    adapters: OutboxAdapterRegistry;
    backoffPolicy: BackoffPolicy;
    clock: Clock;
  }>,
): Promise<"dead_letter" | "delivered" | "retry" | "stale"> {
  const adapter = input.adapters.get(event.eventType);
  if (adapter === undefined) {
    return recordOutboxFailure(pool, event, {
      backoffPolicy: input.backoffPolicy,
      clock: input.clock,
      errorCode: "delivery_failed",
    });
  }

  try {
    await adapter.deliver({
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
      schemaVersion: event.schemaVersion,
    });
  } catch {
    // Adapters receive the stable idempotency key and must deduplicate an
    // effect that completed before the adapter threw or the worker crashed.
    return recordOutboxFailure(pool, event, {
      backoffPolicy: input.backoffPolicy,
      clock: input.clock,
      errorCode: "delivery_failed",
    });
  }

  return completeOutboxDelivery(pool, event, input.clock);
}

export async function dispatchOutboxBatch(
  pool: Pool,
  input: Readonly<{
    adapters: OutboxAdapterRegistry;
    backoffPolicy: BackoffPolicy;
    batchSize: number;
    clock: Clock;
    leaseDurationMs: number;
    leaseOwner: string;
    signal?: AbortSignal;
  }>,
): Promise<OutboxDispatchSummary> {
  const events = await claimOutboxEvents(pool, {
    batchSize: input.batchSize,
    clock: input.clock,
    leaseDurationMs: input.leaseDurationMs,
    leaseOwner: input.leaseOwner,
  });
  const summary = {
    claimed: events.length,
    deadLettered: 0,
    delivered: 0,
    retried: 0,
    stale: 0,
  };

  for (const event of events) {
    if (input.signal?.aborted) break;
    const outcome = await deliverClaimedEvent(pool, event, input);
    if (outcome === "delivered") summary.delivered += 1;
    else if (outcome === "retry") summary.retried += 1;
    else if (outcome === "dead_letter") summary.deadLettered += 1;
    else summary.stale += 1;
  }

  return summary;
}
