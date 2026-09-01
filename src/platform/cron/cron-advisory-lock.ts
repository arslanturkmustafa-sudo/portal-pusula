import { createHash } from "node:crypto";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { configureAndVerifyMySqlSession } from "@/platform/database/mysql-session-contract";

export const CRON_ADVISORY_LOCK_TIMEOUT_MS = 1_000;

const CRON_ADVISORY_LOCK_PREFIX = "pp:cron:";
const CRON_ADVISORY_LOCK_HASH_LENGTH =
  64 - CRON_ADVISORY_LOCK_PREFIX.length;

const GET_LOCK_SQL = "SELECT GET_LOCK(?, 0) AS acquired";
const RELEASE_LOCK_SQL = "SELECT RELEASE_LOCK(?) AS released";

type LockRow = RowDataPacket & {
  acquired?: unknown;
  released?: unknown;
};

export class CronAdvisoryLockError extends Error {
  constructor() {
    super("Cron advisory lock operation failed.");
    this.name = "CronAdvisoryLockError";
  }
}

export type CronAdvisoryLockRunner = (
  pool: Pick<Pool, "getConnection">,
  databaseName: string,
  signal: AbortSignal,
  operation: () => Promise<void>,
) => Promise<boolean>;

export function cronAdvisoryLockName(databaseName: string): string {
  const digest = createHash("sha256")
    .update(databaseName, "utf8")
    .digest("hex")
    .slice(0, CRON_ADVISORY_LOCK_HASH_LENGTH);

  return `${CRON_ADVISORY_LOCK_PREFIX}${digest}`;
}

function hasExpectedValue(rows: LockRow[], field: keyof LockRow): boolean {
  return rows.length === 1 && rows[0]?.[field] === 1;
}

export async function withCronAdvisoryLock(
  pool: Pick<Pool, "getConnection">,
  databaseName: string,
  signal: AbortSignal,
  operation: () => Promise<void>,
): Promise<boolean> {
  if (signal.aborted) {
    throw new CronAdvisoryLockError();
  }

  let connection: PoolConnection;
  try {
    connection = await pool.getConnection();
  } catch {
    throw new CronAdvisoryLockError();
  }

  if (signal.aborted) {
    try {
      connection.destroy();
    } catch {
      // An unverified checkout is never returned to the pool.
    }
    throw new CronAdvisoryLockError();
  }

  const lockName = cronAdvisoryLockName(databaseName);
  let acquired = false;
  let destroyConnection = false;
  let operationFailed = false;

  try {
    await configureAndVerifyMySqlSession(connection, databaseName);

    const [rows] = await connection.query<LockRow[]>({
      sql: GET_LOCK_SQL,
      timeout: CRON_ADVISORY_LOCK_TIMEOUT_MS,
      values: [lockName],
    });
    acquired = hasExpectedValue(rows, "acquired");

    if (!acquired) {
      return false;
    }

    if (signal.aborted) {
      throw new CronAdvisoryLockError();
    }

    await operation();
    return true;
  } catch {
    operationFailed = true;
    destroyConnection ||= !acquired;
    throw new CronAdvisoryLockError();
  } finally {
    if (acquired) {
      try {
        const [rows] = await connection.query<LockRow[]>({
          sql: RELEASE_LOCK_SQL,
          timeout: CRON_ADVISORY_LOCK_TIMEOUT_MS,
          values: [lockName],
        });
        destroyConnection = !hasExpectedValue(rows, "released");
      } catch {
        destroyConnection = true;
      }
    }

    if (destroyConnection) {
      connection.destroy();
      if (!operationFailed) {
        throw new CronAdvisoryLockError();
      }
    } else {
      connection.release();
    }
  }
}
