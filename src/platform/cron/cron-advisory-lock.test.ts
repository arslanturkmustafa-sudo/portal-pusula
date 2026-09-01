import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CRON_ADVISORY_LOCK_TIMEOUT_MS,
  CronAdvisoryLockError,
  cronAdvisoryLockName,
  withCronAdvisoryLock,
} from "@/platform/cron/cron-advisory-lock";
import {
  MYSQL_CANONICAL_SQL_MODE,
  MYSQL_SESSION_SETUP_SQL,
  MYSQL_SESSION_VERIFY_SQL,
} from "@/platform/database/mysql-session-contract";

type FakeConnection = {
  destroy: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function createHarness(queryResults: unknown[]) {
  const connection: FakeConnection = {
    destroy: vi.fn(),
    query: vi.fn(async (statement: string | { sql: string }) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (MYSQL_SESSION_SETUP_SQL.some((candidate) => candidate.sql === sql)) {
        return [[], []];
      }
      if (sql === MYSQL_SESSION_VERIFY_SQL) {
        return [
          [
            {
              autocommit: 1,
              character_set_client: "utf8mb4",
              character_set_connection: "utf8mb4",
              character_set_results: "utf8mb4",
              check_constraint_checks: 1,
              collation_connection: "utf8mb4_unicode_ci",
              current_database: "database",
              default_storage_engine: "InnoDB",
              foreign_key_checks: 1,
              sql_mode: MYSQL_CANONICAL_SQL_MODE,
              time_zone: "+00:00",
              unique_checks: 1,
            },
          ],
          [],
        ];
      }

      const result = queryResults.shift();
      if (result instanceof Error) throw result;
      return [result, []];
    }),
    release: vi.fn(),
  };

  const pool = {
    getConnection: vi.fn().mockResolvedValue(connection as unknown as PoolConnection),
  } as unknown as Pick<Pool, "getConnection">;

  return { connection, pool };
}

describe("cron advisory lock", () => {
  it("derives a fixed safe name without exposing the database name", () => {
    const databaseName = "private_customer_database";
    const first = cronAdvisoryLockName(databaseName);
    const second = cronAdvisoryLockName(databaseName);

    expect(first).toBe(second);
    expect(first).toMatch(/^pp:cron:[a-f0-9]{56}$/u);
    expect(first).toHaveLength(64);
    expect(first).not.toContain(databaseName);
  });

  it("acquires non-blocking, runs once, and releases on the same connection", async () => {
    const { connection, pool } = createHarness([
      [{ acquired: 1 }],
      [{ released: 1 }],
    ]);
    const operation = vi.fn().mockResolvedValue(undefined);

    await expect(
      withCronAdvisoryLock(
        pool,
        "database",
        new AbortController().signal,
        operation,
      ),
    ).resolves.toBe(true);

    expect(operation).toHaveBeenCalledOnce();
    const lockQueries = connection.query.mock.calls.filter(([statement]) =>
      (statement as { sql?: string }).sql?.includes("LOCK"),
    );
    expect(connection.query).toHaveBeenCalledTimes(
      MYSQL_SESSION_SETUP_SQL.length + 3,
    );
    expect(lockQueries[0]?.[0]).toMatchObject({
      sql: "SELECT GET_LOCK(?, 0) AS acquired",
      timeout: CRON_ADVISORY_LOCK_TIMEOUT_MS,
    });
    expect(lockQueries[1]?.[0]).toMatchObject({
      sql: "SELECT RELEASE_LOCK(?) AS released",
      timeout: CRON_ADVISORY_LOCK_TIMEOUT_MS,
    });
    expect((lockQueries[0]?.[0] as { values: unknown }).values).toEqual(
      (lockQueries[1]?.[0] as { values: unknown }).values,
    );
    expect(connection.query.mock.calls.findIndex(([statement]) =>
      (statement as { sql?: string }).sql === MYSQL_SESSION_VERIFY_SQL,
    ))
      .toBeLessThan(
        connection.query.mock.calls.findIndex(
          ([statement]) =>
            (statement as { sql?: string }).sql ===
            "SELECT GET_LOCK(?, 0) AS acquired",
        ),
      );
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("returns a safe no-op when another dispatcher owns the lock", async () => {
    const { connection, pool } = createHarness([[{ acquired: 0 }]]);
    const operation = vi.fn();

    await expect(
      withCronAdvisoryLock(
        pool,
        "database",
        new AbortController().signal,
        operation,
      ),
    ).resolves.toBe(false);

    expect(operation).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("fails closed before obtaining a connection when already aborted", async () => {
    const { pool } = createHarness([]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      withCronAdvisoryLock(pool, "database", controller.signal, vi.fn()),
    ).rejects.toBeInstanceOf(CronAdvisoryLockError);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("destroys an unverified checkout when aborted while waiting for a connection", async () => {
    const { connection } = createHarness([]);
    let resolveConnection: ((value: PoolConnection) => void) | undefined;
    const pendingConnection = new Promise<PoolConnection>((resolve) => {
      resolveConnection = resolve;
    });
    const pool = {
      getConnection: vi.fn().mockReturnValue(pendingConnection),
    } as unknown as Pick<Pool, "getConnection">;
    const controller = new AbortController();
    const operation = vi.fn();

    const result = withCronAdvisoryLock(
      pool,
      "database",
      controller.signal,
      operation,
    );
    controller.abort();
    resolveConnection?.(connection as unknown as PoolConnection);

    await expect(result).rejects.toBeInstanceOf(CronAdvisoryLockError);
    expect(connection.query).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it("releases the lock and redacts an operation failure", async () => {
    const rawFailure = new Error("raw-secret-connection-value");
    const { connection, pool } = createHarness([
      [{ acquired: 1 }],
      [{ released: 1 }],
    ]);

    let caught: unknown;
    try {
      await withCronAdvisoryLock(
        pool,
        "database",
        new AbortController().signal,
        async () => {
          throw rawFailure;
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CronAdvisoryLockError);
    expect(String(caught)).not.toContain(rawFailure.message);
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("destroys a connection when release cannot be proven", async () => {
    const { connection, pool } = createHarness([
      [{ acquired: 1 }],
      new Error("release detail"),
    ]);

    await expect(
      withCronAdvisoryLock(
        pool,
        "database",
        new AbortController().signal,
        vi.fn().mockResolvedValue(undefined),
      ),
    ).rejects.toBeInstanceOf(CronAdvisoryLockError);

    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("redacts acquisition failures and does not reuse the connection", async () => {
    const rawFailure = new Error("raw-db-error-with-secret");
    const { connection, pool } = createHarness([rawFailure]);

    let caught: unknown;
    try {
      await withCronAdvisoryLock(
        pool,
        "database",
        new AbortController().signal,
        vi.fn(),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CronAdvisoryLockError);
    expect(String(caught)).not.toContain(rawFailure.message);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });
});
