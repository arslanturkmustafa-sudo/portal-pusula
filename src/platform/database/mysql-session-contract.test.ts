// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MYSQL_SESSION_POLICY_READBACK_SQL as SCRIPT_SESSION_VERIFY_SQL,
  MYSQL_SESSION_POLICY_QUERY_TIMEOUT_MS as SCRIPT_SESSION_QUERY_TIMEOUT_MS,
  MYSQL_SESSION_POLICY_SET_STATEMENTS as SCRIPT_SESSION_SETUP_SQL,
  MYSQL_SESSION_SQL_MODE as SCRIPT_CANONICAL_SQL_MODE,
} from "../../../scripts/mysql-session-policy.mjs";
import {
  configureAndVerifyMySqlSession,
  MYSQL_CANONICAL_SQL_MODE,
  MYSQL_SESSION_SETUP_SQL,
  MYSQL_SESSION_QUERY_TIMEOUT_MS,
  MYSQL_SESSION_VERIFY_SQL,
  MySqlSessionContractError,
  registeredMySqlPoolDatabase,
  registerMySqlPoolDatabase,
} from "@/platform/database/mysql-session-contract";

const databaseName = "portal_test";

function canonicalRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function connectionWithReadback(row: Record<string, unknown>) {
  const query = vi.fn();
  for (let index = 0; index < MYSQL_SESSION_SETUP_SQL.length; index += 1) {
    query.mockResolvedValueOnce([[], []]);
  }
  query.mockResolvedValueOnce([[row], []]);

  return {
    connection: { query } as unknown as Pick<PoolConnection, "query">,
    query,
  };
}

describe("MySQL session contract", () => {
  it("keeps the runtime and migration-script contracts in exact parity", () => {
    expect(SCRIPT_CANONICAL_SQL_MODE).toBe(MYSQL_CANONICAL_SQL_MODE);
    expect(SCRIPT_SESSION_SETUP_SQL).toEqual(MYSQL_SESSION_SETUP_SQL);
    expect(SCRIPT_SESSION_VERIFY_SQL).toBe(MYSQL_SESSION_VERIFY_SQL);
    expect(SCRIPT_SESSION_QUERY_TIMEOUT_MS).toBe(
      MYSQL_SESSION_QUERY_TIMEOUT_MS,
    );
  });

  it("uses a fixed exact strict mode rather than provider-global inheritance", () => {
    expect(MYSQL_CANONICAL_SQL_MODE).toBe(
      "STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION",
    );
    expect(MYSQL_SESSION_SETUP_SQL).toHaveLength(1);
    expect(MYSQL_SESSION_SETUP_SQL[0]).toMatchObject({
      sql: expect.stringContaining("@@SESSION.sql_mode = ?"),
      values: [MYSQL_CANONICAL_SQL_MODE],
    });
    expect(MYSQL_SESSION_VERIFY_SQL).toContain("DATABASE() AS current_database");
    expect(MYSQL_SESSION_VERIFY_SQL).not.toContain("@@GLOBAL");
  });

  it("sets and verifies every invariant on the same connection", async () => {
    const { connection, query } = connectionWithReadback(canonicalRow());

    await expect(
      configureAndVerifyMySqlSession(connection, databaseName),
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(MYSQL_SESSION_SETUP_SQL.length + 1);
    for (const [index, statement] of MYSQL_SESSION_SETUP_SQL.entries()) {
      expect(query).toHaveBeenNthCalledWith(
        index + 1,
        {
          sql: statement.sql,
          timeout: MYSQL_SESSION_QUERY_TIMEOUT_MS,
          values: [...statement.values],
        },
      );
    }
    expect(query).toHaveBeenLastCalledWith({
      sql: MYSQL_SESSION_VERIFY_SQL,
      timeout: MYSQL_SESSION_QUERY_TIMEOUT_MS,
    });
  });

  it.each([
    ["current_database", "wrong_database"],
    ["sql_mode", "NO_ENGINE_SUBSTITUTION"],
    ["time_zone", "SYSTEM"],
    ["collation_connection", "utf8mb4_general_ci"],
    ["autocommit", 0],
    ["check_constraint_checks", 0],
    ["foreign_key_checks", 0],
    ["unique_checks", 0],
    ["default_storage_engine", "MyISAM"],
  ])("fails closed for a %s mismatch", async (field, value) => {
    const { connection } = connectionWithReadback(
      canonicalRow({ [field]: value }),
    );

    await expect(
      configureAndVerifyMySqlSession(connection, databaseName),
    ).rejects.toEqual(new MySqlSessionContractError());
  });

  it("redacts a SET failure and performs no later query", async () => {
    const rawMessage = "provider-secret-session-error";
    const query = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockRejectedValueOnce(new Error(rawMessage));
    const connection = {
      query,
    } as unknown as Pick<PoolConnection, "query">;

    let caught: unknown;
    try {
      await configureAndVerifyMySqlSession(connection, databaseName);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MySqlSessionContractError);
    expect(String(caught)).not.toContain(rawMessage);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty expected database before issuing SQL", async () => {
    const query = vi.fn();
    const connection = {
      query,
    } as unknown as Pick<PoolConnection, "query">;

    await expect(
      configureAndVerifyMySqlSession(connection, ""),
    ).rejects.toBeInstanceOf(MySqlSessionContractError);
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps expected database metadata out of the mysql2 pool internals", () => {
    const pool = {};

    registerMySqlPoolDatabase(pool, databaseName);

    expect(registeredMySqlPoolDatabase(pool)).toBe(databaseName);
    expect(Object.keys(pool)).toEqual([]);
    expect(() => registerMySqlPoolDatabase(pool, "other_database")).toThrow(
      MySqlSessionContractError,
    );
  });

  it("fails closed for an unregistered pool", () => {
    expect(() => registeredMySqlPoolDatabase({})).toThrow(
      MySqlSessionContractError,
    );
  });
});
