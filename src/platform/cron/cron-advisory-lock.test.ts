import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  CRON_ADVISORY_LOCK_TIMEOUT_MS,
  CronAdvisoryLockError,
  cronAdvisoryLockName,
  withCronAdvisoryLock,
} from "@/platform/cron/cron-advisory-lock";

type FakeConnection = {
  destroy: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function createHarness(queryResults: unknown[]) {
  const connection: FakeConnection = {
    destroy: vi.fn(),
    query: vi.fn(),
    release: vi.fn(),
  };
  for (const result of queryResults) {
    if (result instanceof Error) {
      connection.query.mockRejectedValueOnce(result);
    } else {
      connection.query.mockResolvedValueOnce([result, []]);
    }
  }

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
    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(connection.query.mock.calls[0]?.[0]).toMatchObject({
      sql: "SELECT GET_LOCK(?, 0) AS acquired",
      timeout: CRON_ADVISORY_LOCK_TIMEOUT_MS,
    });
    expect(connection.query.mock.calls[1]?.[0]).toMatchObject({
      sql: "SELECT RELEASE_LOCK(?) AS released",
      timeout: CRON_ADVISORY_LOCK_TIMEOUT_MS,
    });
    expect(connection.query.mock.calls[0]?.[0].values).toEqual(
      connection.query.mock.calls[1]?.[0].values,
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

  it("releases without acquiring when aborted while waiting for a connection", async () => {
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
    expect(connection.release).toHaveBeenCalledOnce();
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
