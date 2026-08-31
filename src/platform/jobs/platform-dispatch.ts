import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  dispatchOutboxBatch,
  productionOutboxAdapterRegistry,
  type OutboxAdapterRegistry,
  type OutboxDispatchSummary,
} from "@/platform/outbox";

import {
  defaultBackoffPolicy,
  type BackoffPolicy,
} from "./backoff";
import { dispatchJobBatch, type JobDispatchSummary } from "./dispatcher";
import { productionJobRegistry } from "./registry";
import { systemClock, type Clock } from "./time";
import type { JobRegistry } from "./types";

const DEFAULT_LEASE_DURATION_MS = 30_000;

export type PlatformWorkDispatchSummary = Readonly<{
  jobs: JobDispatchSummary;
  outbox: OutboxDispatchSummary;
}>;

/**
 * Single bounded entry point for the candidate cron boundary. Production
 * registries are intentionally empty in Komut 3B, so no domain work or real
 * external delivery can occur without a later explicit wiring decision.
 */
export async function dispatchPlatformWork(
  pool: Pool,
  request: Readonly<{
    batchLimit: number;
    correlationId: string;
    signal: AbortSignal;
  }>,
  dependencies: Readonly<{
    adapters?: OutboxAdapterRegistry;
    backoffPolicy?: BackoffPolicy;
    clock?: Clock;
    jobRegistry?: JobRegistry;
    leaseDurationMs?: number;
    leaseOwner?: string;
  }> = {},
): Promise<PlatformWorkDispatchSummary> {
  const clock = dependencies.clock ?? systemClock;
  const backoffPolicy = dependencies.backoffPolicy ?? defaultBackoffPolicy;
  const leaseDurationMs =
    dependencies.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const leaseOwner = dependencies.leaseOwner ?? `cron:${randomUUID()}`;

  if (request.signal.aborted) {
    return {
      jobs: {
        claimed: 0,
        deadLettered: 0,
        retried: 0,
        stale: 0,
        succeeded: 0,
      },
      outbox: {
        claimed: 0,
        deadLettered: 0,
        delivered: 0,
        retried: 0,
        stale: 0,
      },
    };
  }

  const jobs = await dispatchJobBatch(pool, {
    backoffPolicy,
    batchSize: request.batchLimit,
    clock,
    correlationId: request.correlationId,
    leaseDurationMs,
    leaseOwner,
    registry: dependencies.jobRegistry ?? productionJobRegistry,
    signal: request.signal,
  });
  const outbox = request.signal.aborted
    ? {
        claimed: 0,
        deadLettered: 0,
        delivered: 0,
        retried: 0,
        stale: 0,
      }
    : await dispatchOutboxBatch(pool, {
        adapters: dependencies.adapters ?? productionOutboxAdapterRegistry,
        backoffPolicy,
        batchSize: request.batchLimit,
        clock,
        leaseDurationMs,
        leaseOwner,
        signal: request.signal,
      });

  return { jobs, outbox };
}
