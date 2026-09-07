import "server-only";

import { createHmac } from "node:crypto";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";

const QUERY_TIMEOUT_MS = 1_000;
const WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const BLOCK_MILLISECONDS = 15 * 60 * 1_000;
const BUCKET_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const SQL_DATE_TIME_6_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{6})$/u;

const DATABASE_NOW_SQL = `SELECT DATE_FORMAT(
  UTC_TIMESTAMP(6), '%Y-%m-%d %H:%i:%s.%f'
) AS now_utc`;
const DELETE_EXPIRED_ROWS_SQL = `DELETE FROM login_attempt_throttle
 WHERE updated_at_utc < UTC_TIMESTAMP(6) - INTERVAL 24 HOUR
 ORDER BY updated_at_utc ASC
 LIMIT 32`;

type BucketType = "account" | "global" | "network";

type DatabaseNowRow = RowDataPacket & {
  now_utc: unknown;
};

type ThrottleRow = RowDataPacket & {
  blocked_until_utc: unknown;
  bucket_key: unknown;
  bucket_type: unknown;
  failure_count: unknown;
  updated_at_utc: unknown;
  window_started_at_utc: unknown;
};

type Bucket = Readonly<{
  failureLimit: number;
  key: string;
  type: BucketType;
}>;

type ValidatedThrottleRow = Readonly<{
  blockedUntilMs: number | null;
  bucket: Bucket;
  failureCount: number;
  updatedAtMs: number;
  updatedAtUtc: string;
  windowStartedAtMs: number;
}>;

export const LOGIN_THROTTLE_POLICY = Object.freeze({
  accountFailureLimit: 5,
  blockMilliseconds: BLOCK_MILLISECONDS,
  globalFailureLimit: 100,
  networkFailureLimit: 20,
  windowMilliseconds: WINDOW_MILLISECONDS,
});

export type LoginThrottleResult<T> =
  | Readonly<{ status: "authenticated"; value: T }>
  | Readonly<{ status: "blocked" }>
  | Readonly<{ status: "rejected" }>;

export type RunLoginAttemptWithThrottleInput<T> = Readonly<{
  email: string;
  /**
   * An already selected, best-effort network signal. Portal Pusula does not
   * treat proxy headers as a trusted security boundary; account and global
   * buckets remain mandatory even when this signal is absent or unusable.
   */
  networkSignal?: string;
  sessionSecret: string;
  verify: () => Promise<T | null>;
}>;

/** Generic by design: persisted keys, credentials and database details stay private. */
export class LoginThrottleUnavailableError extends Error {
  constructor() {
    super("Login attempt throttling is unavailable.");
    this.name = "LoginThrottleUnavailableError";
  }
}

function failThrottle(): never {
  throw new LoginThrottleUnavailableError();
}

function canonicalAccountIdentity(email: string): string {
  if (typeof email !== "string" || email.length > 254) failThrottle();
  const canonical = email.trim().toLowerCase();
  if (canonical.length < 1 || canonical.length > 254) failThrottle();
  return canonical;
}

function canonicalBestEffortNetworkSignal(
  networkSignal: string | undefined,
): string | null {
  if (typeof networkSignal !== "string") return null;
  const canonical = networkSignal.trim().toLowerCase();
  if (
    canonical.length < 1 ||
    canonical.length > 128 ||
    /[^\x20-\x7E]/u.test(canonical)
  ) {
    return null;
  }
  return canonical;
}

function bucketKey(
  sessionSecret: string,
  type: BucketType,
  identity: string,
): string {
  return createHmac("sha256", sessionSecret)
    .update("portal-pusula/login-throttle/v1\0", "utf8")
    .update(type, "utf8")
    .update("\0", "utf8")
    .update(identity, "utf8")
    .digest("hex");
}

function deriveBuckets(input: {
  email: string;
  networkSignal?: string;
  sessionSecret: string;
}): { account: Bucket; ordered: readonly Bucket[] } {
  if (
    typeof input.sessionSecret !== "string" ||
    !/^[A-Za-z0-9]{16}$/u.test(input.sessionSecret)
  ) {
    failThrottle();
  }

  const accountIdentity = canonicalAccountIdentity(input.email);
  const account: Bucket = {
    failureLimit: LOGIN_THROTTLE_POLICY.accountFailureLimit,
    key: bucketKey(input.sessionSecret, "account", accountIdentity),
    type: "account",
  };
  const buckets: Bucket[] = [
    account,
    {
      failureLimit: LOGIN_THROTTLE_POLICY.globalFailureLimit,
      key: bucketKey(input.sessionSecret, "global", "portal"),
      type: "global",
    },
  ];
  const networkIdentity = canonicalBestEffortNetworkSignal(input.networkSignal);
  if (networkIdentity !== null) {
    buckets.push({
      failureLimit: LOGIN_THROTTLE_POLICY.networkFailureLimit,
      key: bucketKey(input.sessionSecret, "network", networkIdentity),
      type: "network",
    });
  }
  buckets.sort((left, right) => left.key.localeCompare(right.key));
  return { account, ordered: buckets };
}

function parseUtcDateTime6(value: unknown): number {
  if (typeof value !== "string") failThrottle();
  const match = SQL_DATE_TIME_6_PATTERN.exec(value);
  if (match === null) failThrottle();

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, micros] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const wholeSecond = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const roundTrip = new Date(wholeSecond);
  const instant = wholeSecond + Number(micros) / 1_000;

  if (
    !Number.isFinite(instant) ||
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second
  ) {
    failThrottle();
  }
  return instant;
}

async function readDatabaseNow(
  connection: PoolConnection,
): Promise<{ nowMs: number; nowUtc: string }> {
  const [rows] = await connection.query<DatabaseNowRow[]>({
    sql: DATABASE_NOW_SQL,
    timeout: QUERY_TIMEOUT_MS,
  });
  const nowUtc = rows.length === 1 ? rows[0]?.now_utc : undefined;
  if (typeof nowUtc !== "string") failThrottle();
  return { nowMs: parseUtcDateTime6(nowUtc), nowUtc };
}

async function selectThrottleRows(
  connection: PoolConnection,
  buckets: readonly Bucket[],
): Promise<ThrottleRow[]> {
  if (buckets.length < 1 || buckets.length > 3) failThrottle();
  const placeholders = buckets.map(() => "?").join(", ");
  const [rows] = await connection.query<ThrottleRow[]>({
    sql: `SELECT bucket_key, bucket_type, failure_count,
       DATE_FORMAT(window_started_at_utc, '%Y-%m-%d %H:%i:%s.%f')
         AS window_started_at_utc,
       CASE WHEN blocked_until_utc IS NULL THEN NULL ELSE
         DATE_FORMAT(blocked_until_utc, '%Y-%m-%d %H:%i:%s.%f') END
         AS blocked_until_utc,
       DATE_FORMAT(updated_at_utc, '%Y-%m-%d %H:%i:%s.%f')
         AS updated_at_utc
  FROM login_attempt_throttle
 WHERE bucket_key IN (${placeholders})
 ORDER BY bucket_key ASC
 FOR UPDATE`,
    timeout: QUERY_TIMEOUT_MS,
    values: buckets.map((bucket) => bucket.key),
  });
  return rows;
}

function validateRows(
  rows: readonly ThrottleRow[],
  buckets: readonly Bucket[],
  nowMs: number,
): ReadonlyMap<string, ValidatedThrottleRow> {
  const expected = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const validated = new Map<string, ValidatedThrottleRow>();

  for (const row of rows) {
    if (
      typeof row.bucket_key !== "string" ||
      !BUCKET_KEY_PATTERN.test(row.bucket_key) ||
      validated.has(row.bucket_key)
    ) {
      failThrottle();
    }
    const bucket = expected.get(row.bucket_key);
    if (bucket === undefined || row.bucket_type !== bucket.type) failThrottle();
    if (
      typeof row.failure_count !== "number" ||
      !Number.isSafeInteger(row.failure_count) ||
      row.failure_count < 1 ||
      row.failure_count > 1_000
    ) {
      failThrottle();
    }

    const windowStartedAtMs = parseUtcDateTime6(row.window_started_at_utc);
    const updatedAtMs = parseUtcDateTime6(row.updated_at_utc);
    const blockedUntilMs =
      row.blocked_until_utc === null
        ? null
        : parseUtcDateTime6(row.blocked_until_utc);
    if (
      windowStartedAtMs > updatedAtMs ||
      updatedAtMs > nowMs ||
      (blockedUntilMs !== null && blockedUntilMs < updatedAtMs) ||
      (row.failure_count >= bucket.failureLimit) !==
        (blockedUntilMs !== null)
    ) {
      failThrottle();
    }

    validated.set(row.bucket_key, {
      blockedUntilMs,
      bucket,
      failureCount: row.failure_count,
      updatedAtMs,
      updatedAtUtc: row.updated_at_utc as string,
      windowStartedAtMs,
    });
  }

  return validated;
}

function anyBucketBlocked(
  rows: ReadonlyMap<string, ValidatedThrottleRow>,
  nowMs: number,
): boolean {
  return [...rows.values()].some(
    (row) => row.blockedUntilMs !== null && row.blockedUntilMs > nowMs,
  );
}

async function isBlocked(
  pool: Pool,
  buckets: readonly Bucket[],
  account: Bucket,
): Promise<{ accountUpdatedAtUtc: string | null; blocked: boolean }> {
  return withUtcTransaction(pool, async (connection) => {
    const { nowMs } = await readDatabaseNow(connection);
    const rows = validateRows(
      await selectThrottleRows(connection, buckets),
      buckets,
      nowMs,
    );
    return {
      accountUpdatedAtUtc: rows.get(account.key)?.updatedAtUtc ?? null,
      blocked: anyBucketBlocked(rows, nowMs),
    };
  });
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY" &&
    "errno" in error &&
    error.errno === 1062
  );
}

async function insertFirstFailure(
  connection: PoolConnection,
  bucket: Bucket,
  nowUtc: string,
): Promise<void> {
  const [result] = await connection.query<ResultSetHeader>({
    sql: `INSERT INTO login_attempt_throttle
  (bucket_key, bucket_type, failure_count, window_started_at_utc,
   blocked_until_utc, updated_at_utc)
VALUES (?, ?, 1, ?, NULL, ?)`,
    timeout: QUERY_TIMEOUT_MS,
    values: [bucket.key, bucket.type, nowUtc, nowUtc],
  });
  if (result.affectedRows !== 1) failThrottle();
}

async function updateFailure(
  connection: PoolConnection,
  row: ValidatedThrottleRow,
  nowMs: number,
  nowUtc: string,
): Promise<void> {
  const resetWindow =
    nowMs - row.windowStartedAtMs >= WINDOW_MILLISECONDS ||
    (row.blockedUntilMs !== null && row.blockedUntilMs <= nowMs);
  const failureCount = resetWindow ? 1 : row.failureCount + 1;
  if (failureCount > row.bucket.failureLimit) failThrottle();
  const blockedUntilUtc =
    failureCount >= row.bucket.failureLimit
      ? toUtcDateTime6(new Date(nowMs + BLOCK_MILLISECONDS))
      : null;
  const windowStartedAtUtc = resetWindow
    ? nowUtc
    : toUtcDateTime6(new Date(row.windowStartedAtMs));

  const [result] = await connection.query<ResultSetHeader>({
    sql: `UPDATE login_attempt_throttle
   SET failure_count = ?, window_started_at_utc = ?,
       blocked_until_utc = ?, updated_at_utc = ?
 WHERE bucket_key = ? AND BINARY bucket_type = BINARY ?`,
    timeout: QUERY_TIMEOUT_MS,
    values: [
      failureCount,
      windowStartedAtUtc,
      blockedUntilUtc,
      nowUtc,
      row.bucket.key,
      row.bucket.type,
    ],
  });
  if (result.affectedRows !== 1) failThrottle();
}

async function deleteExpiredRows(connection: PoolConnection): Promise<void> {
  const [result] = await connection.query<ResultSetHeader>({
    sql: DELETE_EXPIRED_ROWS_SQL,
    timeout: QUERY_TIMEOUT_MS,
  });
  if (
    !Number.isSafeInteger(result.affectedRows) ||
    result.affectedRows < 0 ||
    result.affectedRows > 32
  ) {
    failThrottle();
  }
}

async function recordFailureOnce(
  pool: Pool,
  buckets: readonly Bucket[],
): Promise<void> {
  await withUtcTransaction(pool, async (connection) => {
    const { nowMs, nowUtc } = await readDatabaseNow(connection);
    const rows = validateRows(
      await selectThrottleRows(connection, buckets),
      buckets,
      nowMs,
    );
    // A racing request may have reached a limit after this request's precheck.
    // It must not extend a block or partially mutate the remaining buckets.
    if (anyBucketBlocked(rows, nowMs)) {
      await deleteExpiredRows(connection);
      return;
    }

    for (const bucket of buckets) {
      const row = rows.get(bucket.key);
      if (row === undefined) {
        await insertFirstFailure(connection, bucket, nowUtc);
      } else {
        await updateFailure(connection, row, nowMs, nowUtc);
      }
    }
    await deleteExpiredRows(connection);
  });
}

async function recordFailure(
  pool: Pool,
  buckets: readonly Bucket[],
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await recordFailureOnce(pool, buckets);
      return;
    } catch (error) {
      if (attempt === 0 && isDuplicateKeyError(error)) continue;
      throw error;
    }
  }
  failThrottle();
}

async function clearAccountFailure(
  pool: Pool,
  account: Bucket,
  expectedUpdatedAtUtc: string | null,
): Promise<void> {
  await withUtcTransaction(pool, async (connection) => {
    // If the account row was absent during the pre-scrypt check, a row
    // appearing now belongs to a concurrent failure and must be preserved.
    if (expectedUpdatedAtUtc !== null) {
      const [result] = await connection.query<ResultSetHeader>({
        sql: `DELETE FROM login_attempt_throttle
 WHERE bucket_key = ?
   AND BINARY bucket_type = BINARY 'account'
   AND updated_at_utc = ?`,
        timeout: QUERY_TIMEOUT_MS,
        values: [account.key, expectedUpdatedAtUtc],
      });
      // Zero means a concurrent failure changed the row after the precheck.
      // That newer evidence wins and must not be erased by this success.
      if (result.affectedRows !== 0 && result.affectedRows !== 1) failThrottle();
    }
    await deleteExpiredRows(connection);
  });
}

/**
 * Runs one credential check behind durable account/global throttles.
 *
 * The block lookup commits before `verify` starts, so scrypt is never invoked
 * for a request already blocked in MariaDB. Failed credentials are recorded in
 * one transaction across every applicable bucket. Operational errors fail
 * closed with a detail-free error. A network signal is deliberately optional;
 * the security guarantee always comes from account plus global buckets.
 */
export async function runLoginAttemptWithThrottle<T>(
  pool: Pool,
  input: RunLoginAttemptWithThrottleInput<T>,
): Promise<LoginThrottleResult<T>> {
  let account: Bucket;
  let buckets: readonly Bucket[];
  try {
    if (typeof input.verify !== "function") failThrottle();
    ({ account, ordered: buckets } = deriveBuckets(input));
  } catch {
    failThrottle();
  }

  let accountUpdatedAtUtc: string | null;
  try {
    const decision = await isBlocked(pool, buckets, account);
    if (decision.blocked) return { status: "blocked" };
    accountUpdatedAtUtc = decision.accountUpdatedAtUtc;
  } catch {
    failThrottle();
  }

  // Verification errors retain their own safe application-level category;
  // they are not credential failures and therefore are not counted.
  const value = await input.verify();
  if (value === null) {
    try {
      await recordFailure(pool, buckets);
    } catch {
      failThrottle();
    }
    return { status: "rejected" };
  }

  try {
    await clearAccountFailure(pool, account, accountUpdatedAtUtc);
  } catch {
    failThrottle();
  }
  return { status: "authenticated", value };
}
