// @vitest-environment node

import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MYSQL_CANONICAL_SQL_MODE,
  MYSQL_SESSION_SETUP_SQL,
  MYSQL_SESSION_VERIFY_SQL,
  MySqlSessionContractError,
  registerMySqlPoolDatabase,
} from "@/platform/database/mysql-session-contract";
import {
  withUtcConsistentRead,
  withUtcTransaction,
} from "@/platform/jobs/mysql-transaction";

const databaseName = "unit_test_db";

function createHarness(options: {
  commitError?: Error;
  operationQueryResult?: unknown;
  policyOverrides?: Record<string, unknown>;
  rollbackError?: Error;
} = {}) {
  const events: string[] = [];
  const query = vi.fn(async (statement: string | { sql: string }) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    events.push(sql);
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
            current_database: databaseName,
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
    return [options.operationQueryResult ?? [], []];
  });
  const connection = {
    beginTransaction: vi.fn(async () => {
      events.push("BEGIN");
    }),
    commit: vi.fn(async () => {
      events.push("COMMIT");
      if (options.commitError) throw options.commitError;
    }),
    destroy: vi.fn(() => {
      events.push("DESTROY");
    }),
    query,
    release: vi.fn(() => {
      events.push("RELEASE");
    }),
    rollback: vi.fn(async () => {
      events.push("ROLLBACK");
      if (options.rollbackError) throw options.rollbackError;
    }),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(async () => connection),
  } as unknown as Pool;
  registerMySqlPoolDatabase(pool, databaseName);

  return { connection, events, pool, query };
}

describe("strict MySQL transaction", () => {
  it("uses one read-only repeatable snapshot for multi-query reports", async () => {
    const { connection, events, pool } = createHarness();
    const operation = vi.fn(async () => "report");

    await expect(withUtcConsistentRead(pool, operation)).resolves.toBe("report");

    expect(events.indexOf("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
      .toBeLessThan(events.indexOf("START TRANSACTION READ ONLY"));
    expect(operation).toHaveBeenCalledExactlyOnceWith(connection);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("establishes the canonical session before isolation and BEGIN", async () => {
    const { connection, events, pool } = createHarness();
    const operation = vi.fn(async () => "completed");

    await expect(withUtcTransaction(pool, operation)).resolves.toBe(
      "completed",
    );

    expect(events.indexOf(MYSQL_SESSION_VERIFY_SQL)).toBeGreaterThanOrEqual(
      MYSQL_SESSION_SETUP_SQL.length,
    );
    expect(events.indexOf(MYSQL_SESSION_VERIFY_SQL)).toBeLessThan(
      events.indexOf("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"),
    );
    expect(events.indexOf("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"))
      .toBeLessThan(events.indexOf("BEGIN"));
    expect(operation).toHaveBeenCalledExactlyOnceWith(connection);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("destroys a policy-mismatched connection without starting work", async () => {
    const { connection, pool } = createHarness({
      policyOverrides: { sql_mode: "NO_ENGINE_SUBSTITUTION" },
    });
    const operation = vi.fn();

    await expect(withUtcTransaction(pool, operation)).rejects.toBeInstanceOf(
      MySqlSessionContractError,
    );

    expect(operation).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("rolls back and destroys after an operation failure", async () => {
    const { connection, pool } = createHarness();
    const operationError = new Error("operation failed");

    await expect(
      withUtcTransaction(pool, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("does not reuse a connection after an uncertain commit", async () => {
    const commitError = new Error("commit outcome unknown");
    const { connection, pool } = createHarness({ commitError });

    await expect(
      withUtcTransaction(pool, async () => undefined),
    ).rejects.toBe(commitError);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("keeps the operation error authoritative when rollback also fails", async () => {
    const operationError = new Error("authoritative operation failure");
    const { connection, pool } = createHarness({
      rollbackError: new Error("rollback detail"),
    });

    await expect(
      withUtcTransaction(pool, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(connection.destroy).toHaveBeenCalledOnce();
  });
});
