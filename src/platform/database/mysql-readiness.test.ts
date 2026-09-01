// @vitest-environment node

import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import { MYSQL_SELECT_ONE_SQL } from "@/platform/database/mysql-readiness-core";
import { probeMySqlReadinessUsingPool } from "@/platform/database/mysql-readiness";
import {
  MYSQL_CANONICAL_SQL_MODE,
  MYSQL_SESSION_SETUP_SQL,
  MYSQL_SESSION_VERIFY_SQL,
} from "@/platform/database/mysql-session-contract";

const environment: DatabaseProbeEnvironment = {
  DB_HOST: "localhost",
  DB_PORT: 3306,
  DB_NAME: "unit_test_db",
  DB_USER: "test_user",
  DB_PASSWORD: "fixture",
};

function createHarness(options: {
  policyOverrides?: Record<string, unknown>;
  readinessResult?: unknown;
  setupNeverResolves?: boolean;
  setupErrorAt?: number;
} = {}) {
  let setupIndex = 0;
  const query = vi.fn(async (statement: string | { sql: string }) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const policyStatement = MYSQL_SESSION_SETUP_SQL.find(
      (candidate) => candidate.sql === sql,
    );
    if (policyStatement) {
      setupIndex += 1;
      if (options.setupNeverResolves) {
        return new Promise<never>(() => undefined);
      }
      if (setupIndex === options.setupErrorAt) {
        throw new Error("sensitive setup error");
      }
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
            current_database: environment.DB_NAME,
            default_storage_engine: "InnoDB",
            foreign_key_checks: 1,
            sql_mode: MYSQL_CANONICAL_SQL_MODE,
            time_zone: "+00:00",
            unique_checks: 1,
            ...options.policyOverrides,
          },
        ],
        [],
      ];
    }
    if (sql === MYSQL_SELECT_ONE_SQL) {
      return options.readinessResult ?? [[{ readiness_ok: 1 }], []];
    }
    throw new Error("unexpected query");
  });
  const connection = {
    destroy: vi.fn(),
    query,
    release: vi.fn(),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(async () => connection),
  } as unknown as Pick<Pool, "getConnection">;

  return { connection, pool, query };
}

describe("strict MySQL readiness", () => {
  it("checks the canonical session and SELECT 1 on one connection", async () => {
    const { connection, pool, query } = createHarness();

    await expect(
      probeMySqlReadinessUsingPool(pool, environment),
    ).resolves.toBe(true);

    const verifyIndex = query.mock.calls.findIndex(
      ([statement]) =>
        (statement as { sql?: string }).sql === MYSQL_SESSION_VERIFY_SQL,
    );
    const selectIndex = query.mock.calls.findIndex(
      ([statement]) => (statement as { sql?: string }).sql === MYSQL_SELECT_ONE_SQL,
    );
    expect(verifyIndex).toBeGreaterThanOrEqual(MYSQL_SESSION_SETUP_SQL.length);
    expect(verifyIndex).toBeLessThan(selectIndex);
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("returns false and destroys a session-policy mismatch", async () => {
    const { connection, pool, query } = createHarness({
      policyOverrides: { foreign_key_checks: 0 },
    });

    await expect(
      probeMySqlReadinessUsingPool(pool, environment),
    ).resolves.toBe(false);

    expect(query.mock.calls).not.toContainEqual([
      expect.objectContaining({ sql: MYSQL_SELECT_ONE_SQL }),
    ]);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("returns false and destroys after a SET failure", async () => {
    const { connection, pool, query } = createHarness({ setupErrorAt: 1 });

    await expect(
      probeMySqlReadinessUsingPool(pool, environment),
    ).resolves.toBe(false);

    expect(query).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("does not reuse a connection after SELECT 1 cannot prove readiness", async () => {
    const { connection, pool } = createHarness({
      readinessResult: [[{ readiness_ok: 0 }], []],
    });

    await expect(
      probeMySqlReadinessUsingPool(pool, environment),
    ).resolves.toBe(false);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("enforces the total readiness deadline across session setup", async () => {
    const { connection, pool } = createHarness({ setupNeverResolves: true });

    await expect(
      probeMySqlReadinessUsingPool(pool, environment, { deadlineMs: 5 }),
    ).resolves.toBe(false);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("includes pool checkout in the deadline and destroys a late connection", async () => {
    const { connection } = createHarness();
    let resolveConnection: ((value: PoolConnection) => void) | undefined;
    const pool = {
      getConnection: vi.fn(
        () =>
          new Promise<PoolConnection>((resolve) => {
            resolveConnection = resolve;
          }),
      ),
    } as unknown as Pick<Pool, "getConnection">;

    await expect(
      probeMySqlReadinessUsingPool(pool, environment, { deadlineMs: 5 }),
    ).resolves.toBe(false);
    expect(resolveConnection).toBeTypeOf("function");
    resolveConnection?.(connection);
    await vi.waitFor(() => {
      expect(connection.destroy).toHaveBeenCalledOnce();
    });
    expect(connection.release).not.toHaveBeenCalled();
  });
});
