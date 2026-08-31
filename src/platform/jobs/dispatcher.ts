import "server-only";

import type { Pool } from "mysql2/promise";

import type { BackoffPolicy } from "./backoff";
import {
  claimScheduledJobs,
  recordJobFailure,
  runClaimedJobTransaction,
} from "./repository";
import type { Clock } from "./time";
import {
  safeJobErrorCode,
  type ClaimedJob,
  type JobExecutionOutcome,
  type JobRegistry,
} from "./types";

export type JobDispatchSummary = Readonly<{
  claimed: number;
  deadLettered: number;
  retried: number;
  stale: number;
  succeeded: number;
}>;

export async function executeClaimedJob(
  pool: Pool,
  job: ClaimedJob,
  input: Readonly<{
    backoffPolicy: BackoffPolicy;
    clock: Clock;
    registry: JobRegistry;
  }>,
): Promise<JobExecutionOutcome> {
  const handler = input.registry.get(job.jobType);
  if (handler === undefined) {
    return recordJobFailure(pool, job, {
      backoffPolicy: input.backoffPolicy,
      clock: input.clock,
      errorCode: "handler_not_registered",
    });
  }

  try {
    return await runClaimedJobTransaction(pool, job, {
      clock: input.clock,
      operation: (connection, occurredAtUtc) =>
        handler({ connection, job, occurredAtUtc }),
    });
  } catch (error) {
    return recordJobFailure(pool, job, {
      backoffPolicy: input.backoffPolicy,
      clock: input.clock,
      errorCode: safeJobErrorCode(error),
    });
  }
}

export async function dispatchJobBatch(
  pool: Pool,
  input: Readonly<{
    backoffPolicy: BackoffPolicy;
    batchSize: number;
    clock: Clock;
    correlationId: string;
    leaseDurationMs: number;
    leaseOwner: string;
    registry: JobRegistry;
    signal?: AbortSignal;
  }>,
): Promise<JobDispatchSummary> {
  const jobs = await claimScheduledJobs(pool, {
    batchSize: input.batchSize,
    clock: input.clock,
    correlationId: input.correlationId,
    leaseDurationMs: input.leaseDurationMs,
    leaseOwner: input.leaseOwner,
  });
  const summary = {
    claimed: jobs.length,
    deadLettered: 0,
    retried: 0,
    stale: 0,
    succeeded: 0,
  };

  for (const job of jobs) {
    if (input.signal?.aborted) break;
    const outcome = await executeClaimedJob(pool, job, input);
    if (outcome === "succeeded") summary.succeeded += 1;
    else if (outcome === "retry") summary.retried += 1;
    else if (outcome === "dead_letter") summary.deadLettered += 1;
    else summary.stale += 1;
  }

  return summary;
}
