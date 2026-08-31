import "server-only";

import { randomUUID } from "node:crypto";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { BackoffPolicy } from "@/platform/jobs/backoff";
import { retryAt } from "@/platform/jobs/backoff";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import type { Clock } from "@/platform/jobs/time";
import { addMilliseconds, toUtcDateTime6 } from "@/platform/jobs/time";
import {
  assertCanonicalAsciiKey,
  assertCanonicalUuid,
  assertMaxAttempts,
} from "@/platform/validation/canonical-identifiers";

const MAX_OUTBOX_BATCH_SIZE = 25;
const MAX_LEASE_DURATION_MS = 60_000;
const MAX_EVENT_TYPE_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 191;

export type OutboxErrorCode =
  | "delivery_failed"
  | "lease_expired"
  | "unexpected_error";

export type EnqueueOutboxEventInput = Readonly<{
  availableAtUtc: string;
  eventType: string;
  id?: string;
  idempotencyKey: string;
  maxAttempts: number;
  payload: unknown;
  schemaVersion: number;
}>;

export type EnqueueOutboxEventResult = Readonly<{
  id: string;
  inserted: boolean;
}>;

export type ClaimedOutboxEvent = Readonly<{
  attemptNo: number;
  eventType: string;
  id: string;
  idempotencyKey: string;
  leaseOwner: string;
  leaseToken: string;
  maxAttempts: number;
  payload: unknown;
  schemaVersion: number;
}>;

interface OutboxCandidateRow extends RowDataPacket {
  attempt_count: number;
  event_type: string;
  id: string;
  idempotency_key: string;
  max_attempts: number;
  payload: string | unknown;
  schema_version: number;
  status: string;
}

interface OutboxIdentityRow extends RowDataPacket {
  id: string;
}

interface OutboxLeaseRow extends RowDataPacket {
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
    throw new Error("Outbox payload is not serializable.");
  }
}

function parsePayload(value: string | unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Outbox payload is invalid.");
  }
}

function assertClaimLimits(batchSize: number, leaseDurationMs: number): void {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_OUTBOX_BATCH_SIZE ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1 ||
    leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new Error("Outbox claim limits are invalid.");
  }
}

export async function enqueueOutboxEvent(
  connection: PoolConnection,
  input: EnqueueOutboxEventInput,
): Promise<EnqueueOutboxEventResult> {
  const id =
    input.id === undefined ? randomUUID() : assertCanonicalUuid(input.id);
  assertCanonicalAsciiKey(input.eventType, MAX_EVENT_TYPE_LENGTH);
  assertCanonicalAsciiKey(
    input.idempotencyKey,
    MAX_IDEMPOTENCY_KEY_LENGTH,
  );
  assertMaxAttempts(input.maxAttempts);

  try {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO outbox_event
         (id, event_type, schema_version, payload, idempotency_key,
          available_at_utc, status, attempt_count, max_attempts,
          created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        id,
        input.eventType,
        input.schemaVersion,
        serializePayload(input.payload),
        input.idempotencyKey,
        input.availableAtUtc,
        input.maxAttempts,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new Error("Outbox enqueue failed.");
    }
    return { id, inserted: true };
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;

    const [rows] = await connection.execute<OutboxIdentityRow[]>(
      `SELECT id FROM outbox_event WHERE idempotency_key = ?`,
      [input.idempotencyKey],
    );
    const existingId = rows[0]?.id;
    if (rows.length !== 1 || existingId === undefined) {
      throw new Error("Outbox enqueue failed.");
    }
    return { id: existingId, inserted: false };
  }
}

export async function enqueueOutboxEventUsingPool(
  pool: Pool,
  input: EnqueueOutboxEventInput,
): Promise<EnqueueOutboxEventResult> {
  return withUtcTransaction(pool, (connection) =>
    enqueueOutboxEvent(connection, input),
  );
}

export type ClaimOutboxEventsInput = Readonly<{
  batchSize: number;
  clock: Clock;
  leaseDurationMs: number;
  leaseOwner: string;
}>;

async function claimOutboxEventsOnce(
  pool: Pool,
  input: ClaimOutboxEventsInput,
): Promise<ClaimedOutboxEvent[]> {
  assertClaimLimits(input.batchSize, input.leaseDurationMs);
  assertCanonicalAsciiKey(input.leaseOwner, 128);
  const now = input.clock.now();
  const nowUtc = toUtcDateTime6(now);
  const leaseExpiresAtUtc = toUtcDateTime6(
    addMilliseconds(now, input.leaseDurationMs),
  );

  return withUtcTransaction(pool, async (connection) => {
    const [rows] = await connection.execute<OutboxCandidateRow[]>(
      `SELECT id, event_type, schema_version, payload, idempotency_key,
              status, attempt_count, max_attempts
       FROM outbox_event
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

    const claims: ClaimedOutboxEvent[] = [];
    for (const row of rows) {
      const attemptNo = Number(row.attempt_count) + 1;
      const leaseToken = randomUUID();
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE outbox_event
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
          row.attempt_count,
          nowUtc,
          nowUtc,
        ],
      );
      if (updated.affectedRows !== 1) continue;

      claims.push({
        attemptNo,
        eventType: row.event_type,
        id: row.id,
        idempotencyKey: row.idempotency_key,
        leaseOwner: input.leaseOwner,
        leaseToken,
        maxAttempts: Number(row.max_attempts),
        payload: parsePayload(row.payload),
        schemaVersion: Number(row.schema_version),
      });
    }

    await connection.query<ResultSetHeader>(
      `UPDATE outbox_event
       SET status = 'dead_letter',
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at_utc = NULL,
           last_error_code = 'lease_expired',
           updated_at_utc = ?
       WHERE status = 'leased'
         AND lease_expires_at_utc <= ?
         AND attempt_count >= max_attempts
       LIMIT ${input.batchSize}`,
      [nowUtc, nowUtc],
    );

    return claims;
  });
}

export async function claimOutboxEvents(
  pool: Pool,
  input: ClaimOutboxEventsInput,
): Promise<ClaimedOutboxEvent[]> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await claimOutboxEventsOnce(pool, input);
    } catch (error) {
      if (!isDeadlock(error) || attempt === 3) {
        if (isDeadlock(error)) throw new Error("Outbox claim failed.");
        throw error;
      }
    }
  }

  throw new Error("Outbox claim failed.");
}

async function lockedOutboxLease(
  connection: PoolConnection,
  event: ClaimedOutboxEvent,
): Promise<OutboxLeaseRow | undefined> {
  const [rows] = await connection.execute<OutboxLeaseRow[]>(
    `SELECT status, attempt_count, max_attempts, lease_token
     FROM outbox_event
     WHERE id = ?
     FOR UPDATE`,
    [event.id],
  );
  const row = rows[0];
  if (
    row === undefined ||
    row.status !== "leased" ||
    row.lease_token !== event.leaseToken ||
    Number(row.attempt_count) !== event.attemptNo
  ) {
    return undefined;
  }
  return row;
}

export async function completeOutboxDelivery(
  pool: Pool,
  event: ClaimedOutboxEvent,
  clock: Clock,
): Promise<"delivered" | "stale"> {
  return withUtcTransaction(pool, async (connection) => {
    if ((await lockedOutboxLease(connection, event)) === undefined) {
      return "stale";
    }

    const completedAtUtc = toUtcDateTime6(clock.now());
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE outbox_event
       SET status = 'delivered',
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at_utc = NULL,
           delivered_at_utc = ?,
           last_error_code = NULL,
           updated_at_utc = ?
       WHERE id = ? AND status = 'leased' AND lease_token = ? AND attempt_count = ?`,
      [completedAtUtc, completedAtUtc, event.id, event.leaseToken, event.attemptNo],
    );
    return result.affectedRows === 1 ? "delivered" : "stale";
  });
}

export async function recordOutboxFailure(
  pool: Pool,
  event: ClaimedOutboxEvent,
  input: Readonly<{
    backoffPolicy: BackoffPolicy;
    clock: Clock;
    errorCode: OutboxErrorCode;
  }>,
): Promise<"dead_letter" | "retry" | "stale"> {
  return withUtcTransaction(pool, async (connection) => {
    const lease = await lockedOutboxLease(connection, event);
    if (lease === undefined) return "stale";

    const now = input.clock.now();
    const nowUtc = toUtcDateTime6(now);
    const exhausted = event.attemptNo >= Number(lease.max_attempts);
    const availableAtUtc = exhausted
      ? nowUtc
      : toUtcDateTime6(retryAt(now, event.attemptNo, input.backoffPolicy));
    const nextStatus = exhausted ? "dead_letter" : "retry";
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE outbox_event
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
        event.id,
        event.leaseToken,
        event.attemptNo,
      ],
    );
    if (result.affectedRows !== 1) return "stale";
    return nextStatus;
  });
}
