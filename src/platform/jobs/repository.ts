import "server-only";

import { randomUUID } from "node:crypto";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { BackoffPolicy } from "./backoff";
import { retryAt } from "./backoff";
import { withUtcTransaction } from "./mysql-transaction";
import type { Clock } from "./time";
import { addMilliseconds, toUtcDateTime6 } from "./time";
import type { ClaimedJob, JobErrorCode, JobExecutionOutcome } from "./types";
import {
  assertCanonicalAsciiKey,
  assertCanonicalUuid,
  assertMaxAttempts,
} from "@/platform/validation/canonical-identifiers";

const MAX_JOB_BATCH_SIZE = 25;
const MAX_LEASE_DURATION_MS = 60_000;
const MAX_JOB_TYPE_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 191;
const MAX_CATCH_UP_PREFIX_LENGTH = 166;
export const MAX_CATCH_UP_WINDOWS = 32;

export type EnqueueScheduledJobInput = Readonly<{
  availableAtUtc: string;
  id?: string;
  idempotencyKey: string;
  jobType: string;
  maxAttempts: number;
  payload: unknown;
  payloadSchemaVersion: number;
  scheduledAtUtc: string;
}>;

export type EnqueueScheduledJobResult = Readonly<{
  id: string;
  inserted: boolean;
}>;

interface JobCandidateRow extends RowDataPacket {
  attempt_count: number;
  id: string;
  job_type: string;
  lease_token: string | null;
  max_attempts: number;
  payload: string | unknown;
  payload_schema_version: number;
  status: string;
}

interface JobIdentityRow extends RowDataPacket {
  id: string;
}

interface ExhaustedJobRow extends RowDataPacket {
  attempt_count: number;
  id: string;
  lease_token: string | null;
}

interface JobLeaseRow extends RowDataPacket {
  attempt_count: number;
  lease_token: string | null;
  max_attempts: number;
  status: string;
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function isDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_LOCK_DEADLOCK"
  );
}

function serializePayload(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new Error("Job payload is not serializable.");
  }
}

function parsePayload(value: string | unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Job payload is invalid.");
  }
}

function assertClaimLimits(batchSize: number, leaseDurationMs: number): void {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_JOB_BATCH_SIZE ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1 ||
    leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new Error("Job claim limits are invalid.");
  }
}

async function enqueueScheduledJobUsingConnection(
  connection: PoolConnection,
  input: EnqueueScheduledJobInput,
): Promise<EnqueueScheduledJobResult> {
  const id =
    input.id === undefined ? randomUUID() : assertCanonicalUuid(input.id);
  assertCanonicalAsciiKey(input.jobType, MAX_JOB_TYPE_LENGTH);
  assertCanonicalAsciiKey(
    input.idempotencyKey,
    MAX_IDEMPOTENCY_KEY_LENGTH,
  );
  assertMaxAttempts(input.maxAttempts);

  try {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO scheduled_job
         (id, job_type, payload_schema_version, payload, scheduled_at_utc,
          available_at_utc, status, attempt_count, max_attempts,
          idempotency_key, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        id,
        input.jobType,
        input.payloadSchemaVersion,
        serializePayload(input.payload),
        input.scheduledAtUtc,
        input.availableAtUtc,
        input.maxAttempts,
        input.idempotencyKey,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new Error("Job enqueue failed.");
    }
    return { id, inserted: true };
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;

    const [rows] = await connection.execute<JobIdentityRow[]>(
      `SELECT id FROM scheduled_job WHERE job_type = ? AND idempotency_key = ?`,
      [input.jobType, input.idempotencyKey],
    );
    const existingId = rows[0]?.id;
    if (rows.length !== 1 || existingId === undefined) {
      throw new Error("Job enqueue failed.");
    }
    return { id: existingId, inserted: false };
  }
}

export async function enqueueScheduledJob(
  pool: Pool,
  input: EnqueueScheduledJobInput,
): Promise<EnqueueScheduledJobResult> {
  return withUtcTransaction(pool, (connection) =>
    enqueueScheduledJobUsingConnection(connection, input),
  );
}

export async function enqueueCatchUpWindows(
  pool: Pool,
  input: Readonly<{
    clock: Clock;
    idempotencyPrefix: string;
    intervalMs: number;
    jobType: string;
    maxAttempts: number;
    maxWindows: number;
    payloadForWindow: (window: {
      endAtUtc: string;
      startAtUtc: string;
    }) => unknown;
    payloadSchemaVersion: number;
  }>,
): Promise<Readonly<{ inserted: number; windows: number }>> {
  assertCanonicalAsciiKey(input.jobType, MAX_JOB_TYPE_LENGTH);
  assertCanonicalAsciiKey(
    input.idempotencyPrefix,
    MAX_CATCH_UP_PREFIX_LENGTH,
  );
  assertMaxAttempts(input.maxAttempts);

  if (
    !Number.isSafeInteger(input.intervalMs) ||
    input.intervalMs < 1 ||
    !Number.isSafeInteger(input.maxWindows) ||
    input.maxWindows < 1 ||
    input.maxWindows > MAX_CATCH_UP_WINDOWS
  ) {
    throw new Error("Catch-up limits are invalid.");
  }

  const nowMs = input.clock.now().getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Catch-up clock is invalid.");
  const latestCompletedWindowStart =
    Math.floor(nowMs / input.intervalMs) * input.intervalMs - input.intervalMs;
  const earliestWindowStart =
    latestCompletedWindowStart - (input.maxWindows - 1) * input.intervalMs;

  let inserted = 0;
  for (let index = 0; index < input.maxWindows; index += 1) {
    const start = new Date(earliestWindowStart + index * input.intervalMs);
    const end = new Date(start.getTime() + input.intervalMs);
    const startAtUtc = toUtcDateTime6(start);
    const endAtUtc = toUtcDateTime6(end);
    const result = await enqueueScheduledJob(pool, {
      availableAtUtc: endAtUtc,
      idempotencyKey: `${input.idempotencyPrefix}:${start.toISOString()}`,
      jobType: input.jobType,
      maxAttempts: input.maxAttempts,
      payload: input.payloadForWindow({ endAtUtc, startAtUtc }),
      payloadSchemaVersion: input.payloadSchemaVersion,
      scheduledAtUtc: endAtUtc,
    });
    if (result.inserted) inserted += 1;
  }

  return { inserted, windows: input.maxWindows };
}

export type ClaimScheduledJobsInput = Readonly<{
  batchSize: number;
  clock: Clock;
  correlationId: string;
  leaseDurationMs: number;
  leaseOwner: string;
}>;

async function claimScheduledJobsOnce(
  pool: Pool,
  input: ClaimScheduledJobsInput,
): Promise<ClaimedJob[]> {
  assertClaimLimits(input.batchSize, input.leaseDurationMs);
  assertCanonicalAsciiKey(input.correlationId, 64);
  assertCanonicalAsciiKey(input.leaseOwner, 128);
  const now = input.clock.now();
  const nowUtc = toUtcDateTime6(now);
  const leaseExpiresAtUtc = toUtcDateTime6(
    addMilliseconds(now, input.leaseDurationMs),
  );

  return withUtcTransaction(pool, async (connection) => {
    const [rows] = await connection.execute<JobCandidateRow[]>(
      `SELECT id, job_type, payload_schema_version, payload, status,
              attempt_count, max_attempts, lease_token
       FROM scheduled_job
       WHERE attempt_count < max_attempts
         AND (
           (status IN ('pending', 'retry') AND available_at_utc <= ?)
           OR (status = 'leased' AND lease_expires_at_utc <= ?)
         )
       ORDER BY
         CASE WHEN status = 'leased' THEN lease_expires_at_utc ELSE available_at_utc END,
         id
       LIMIT ${input.batchSize}
       FOR UPDATE`,
      [nowUtc, nowUtc],
    );

    const claims: ClaimedJob[] = [];
    for (const row of rows) {
      const previousAttemptNo = Number(row.attempt_count);
      if (row.status === "leased") {
        if (row.lease_token === null) {
          throw new Error("Expired job lease is invalid.");
        }
        const [expiredRun] = await connection.execute<ResultSetHeader>(
          `UPDATE job_run
           SET completed_at_utc = ?, outcome = 'lease_expired', error_code = 'lease_expired'
           WHERE job_id = ? AND attempt_no = ? AND lease_token = ?
             AND outcome = 'running' AND completed_at_utc IS NULL`,
          [nowUtc, row.id, previousAttemptNo, row.lease_token],
        );
        if (expiredRun.affectedRows !== 1) {
          throw new Error("Expired job run history is invalid.");
        }
      }

      const attemptNo = previousAttemptNo + 1;
      const leaseToken = randomUUID();
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE scheduled_job
         SET status = 'leased',
             attempt_count = ?,
             lease_owner = ?,
             lease_token = ?,
             lease_expires_at_utc = ?,
             updated_at_utc = ?
         WHERE id = ?
           AND attempt_count = ?
           AND attempt_count < max_attempts
           AND (
             (status IN ('pending', 'retry') AND available_at_utc <= ?)
             OR (status = 'leased' AND lease_expires_at_utc <= ?)
           )`,
        [
          attemptNo,
          input.leaseOwner,
          leaseToken,
          leaseExpiresAtUtc,
          nowUtc,
          row.id,
          previousAttemptNo,
          nowUtc,
          nowUtc,
        ],
      );
      if (updated.affectedRows !== 1) {
        throw new Error("Job claim fencing failed.");
      }

      const [insertedRun] = await connection.execute<ResultSetHeader>(
        `INSERT INTO job_run
           (id, job_id, attempt_no, lease_token, lease_owner, started_at_utc,
            outcome, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
        [
          randomUUID(),
          row.id,
          attemptNo,
          leaseToken,
          input.leaseOwner,
          nowUtc,
          input.correlationId,
        ],
      );
      if (insertedRun.affectedRows !== 1) {
        throw new Error("Job run creation failed.");
      }

      claims.push({
        attemptNo,
        correlationId: input.correlationId,
        id: row.id,
        jobType: row.job_type,
        leaseOwner: input.leaseOwner,
        leaseToken,
        maxAttempts: Number(row.max_attempts),
        payload: parsePayload(row.payload),
        payloadSchemaVersion: Number(row.payload_schema_version),
      });
    }

    // Keep the claim lock order stable: ready/reclaim candidates are locked
    // first, then exhausted expired leases and their exact run history are
    // finalized as the last bounded work in the same transaction.
    const [exhaustedRows] = await connection.execute<ExhaustedJobRow[]>(
      `SELECT id, attempt_count, lease_token
       FROM scheduled_job
       WHERE status = 'leased'
         AND lease_expires_at_utc <= ?
         AND attempt_count >= max_attempts
       ORDER BY lease_expires_at_utc, id
       LIMIT ${input.batchSize}
       FOR UPDATE`,
      [nowUtc],
    );

    for (const exhausted of exhaustedRows) {
      if (exhausted.lease_token === null) {
        throw new Error("Exhausted job lease is invalid.");
      }

      const [runResult] = await connection.execute<ResultSetHeader>(
        `UPDATE job_run
         SET completed_at_utc = ?, outcome = 'lease_expired', error_code = 'lease_expired'
         WHERE job_id = ? AND attempt_no = ? AND lease_token = ?
           AND outcome = 'running' AND completed_at_utc IS NULL`,
        [
          nowUtc,
          exhausted.id,
          exhausted.attempt_count,
          exhausted.lease_token,
        ],
      );
      if (runResult.affectedRows !== 1) {
        throw new Error("Exhausted job run history is invalid.");
      }

      const [jobResult] = await connection.execute<ResultSetHeader>(
        `UPDATE scheduled_job
         SET status = 'dead_letter',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at_utc = NULL,
             last_error_code = 'lease_expired',
             updated_at_utc = ?
         WHERE id = ? AND status = 'leased' AND lease_token = ?
           AND attempt_count = ? AND attempt_count >= max_attempts
           AND lease_expires_at_utc <= ?`,
        [
          nowUtc,
          exhausted.id,
          exhausted.lease_token,
          exhausted.attempt_count,
          nowUtc,
        ],
      );
      if (jobResult.affectedRows !== 1) {
        throw new Error("Exhausted job finalization failed.");
      }
    }

    return claims;
  });
}

export async function claimScheduledJobs(
  pool: Pool,
  input: ClaimScheduledJobsInput,
): Promise<ClaimedJob[]> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await claimScheduledJobsOnce(pool, input);
    } catch (error) {
      if (!isDeadlock(error) || attempt === 3) {
        if (isDeadlock(error)) throw new Error("Job claim failed.");
        throw error;
      }
    }
  }

  throw new Error("Job claim failed.");
}

async function lockedJobLease(
  connection: PoolConnection,
  job: ClaimedJob,
): Promise<JobLeaseRow | undefined> {
  const [rows] = await connection.execute<JobLeaseRow[]>(
    `SELECT status, attempt_count, max_attempts, lease_token
     FROM scheduled_job
     WHERE id = ?
     FOR UPDATE`,
    [job.id],
  );
  const row = rows[0];
  if (
    row === undefined ||
    row.status !== "leased" ||
    row.lease_token !== job.leaseToken ||
    Number(row.attempt_count) !== job.attemptNo
  ) {
    return undefined;
  }
  return row;
}

export async function runClaimedJobTransaction(
  pool: Pool,
  job: ClaimedJob,
  input: Readonly<{
    clock: Clock;
    operation: (connection: PoolConnection, occurredAtUtc: string) => Promise<void>;
  }>,
): Promise<"stale" | "succeeded"> {
  return withUtcTransaction(pool, async (connection) => {
    if ((await lockedJobLease(connection, job)) === undefined) return "stale";

    const completedAtUtc = toUtcDateTime6(input.clock.now());
    await input.operation(connection, completedAtUtc);

    const [jobResult] = await connection.execute<ResultSetHeader>(
      `UPDATE scheduled_job
       SET status = 'succeeded',
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at_utc = NULL,
           last_error_code = NULL,
           updated_at_utc = ?
       WHERE id = ? AND status = 'leased' AND lease_token = ? AND attempt_count = ?`,
      [completedAtUtc, job.id, job.leaseToken, job.attemptNo],
    );
    if (jobResult.affectedRows !== 1) throw new Error("Job lease became stale.");

    const [runResult] = await connection.execute<ResultSetHeader>(
      `UPDATE job_run
       SET completed_at_utc = ?, outcome = 'succeeded', error_code = NULL
       WHERE job_id = ? AND attempt_no = ? AND lease_token = ? AND outcome = 'running'`,
      [completedAtUtc, job.id, job.attemptNo, job.leaseToken],
    );
    if (runResult.affectedRows !== 1) throw new Error("Job run finalize failed.");
    return "succeeded";
  });
}

export async function completeClaimedJob(
  pool: Pool,
  job: ClaimedJob,
  clock: Clock,
): Promise<"stale" | "succeeded"> {
  return runClaimedJobTransaction(pool, job, {
    clock,
    operation: async () => undefined,
  });
}

export async function recordJobFailure(
  pool: Pool,
  job: ClaimedJob,
  input: Readonly<{
    backoffPolicy: BackoffPolicy;
    clock: Clock;
    errorCode: JobErrorCode;
  }>,
): Promise<Exclude<JobExecutionOutcome, "succeeded">> {
  return withUtcTransaction(pool, async (connection) => {
    const lease = await lockedJobLease(connection, job);
    if (lease === undefined) return "stale";

    const now = input.clock.now();
    const nowUtc = toUtcDateTime6(now);
    const exhausted = job.attemptNo >= Number(lease.max_attempts);
    const availableAtUtc = exhausted
      ? nowUtc
      : toUtcDateTime6(retryAt(now, job.attemptNo, input.backoffPolicy));
    const nextStatus = exhausted ? "dead_letter" : "retry";
    const [jobResult] = await connection.execute<ResultSetHeader>(
      `UPDATE scheduled_job
       SET status = ?,
           available_at_utc = ?,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at_utc = NULL,
           last_error_code = ?,
           updated_at_utc = ?
       WHERE id = ? AND status = 'leased' AND lease_token = ? AND attempt_count = ?`,
      [
        nextStatus,
        availableAtUtc,
        input.errorCode,
        nowUtc,
        job.id,
        job.leaseToken,
        job.attemptNo,
      ],
    );
    if (jobResult.affectedRows !== 1) return "stale";

    const [runResult] = await connection.execute<ResultSetHeader>(
      `UPDATE job_run
       SET completed_at_utc = ?, outcome = ?, error_code = ?
       WHERE job_id = ? AND attempt_no = ? AND lease_token = ? AND outcome = 'running'`,
      [
        nowUtc,
        nextStatus,
        input.errorCode,
        job.id,
        job.attemptNo,
        job.leaseToken,
      ],
    );
    if (runResult.affectedRows !== 1) throw new Error("Job run failure finalize failed.");
    return nextStatus;
  });
}
