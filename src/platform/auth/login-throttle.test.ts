// @vitest-environment node

import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MYSQL_CANONICAL_SQL_MODE,
  MYSQL_SESSION_VERIFY_SQL,
  registerMySqlPoolDatabase,
} from "@/platform/database/mysql-session-contract";
import {
  LOGIN_THROTTLE_POLICY,
  LoginThrottleUnavailableError,
  runLoginAttemptWithThrottle,
} from "@/platform/auth/login-throttle";

const databaseName = "unit_test_db";
const sessionSecret = "AbcdEFgh12345678";

type StoredRow = {
  blocked_until_utc: string | null;
  bucket_key: string;
  bucket_type: "account" | "global" | "network";
  failure_count: number;
  updated_at_utc: string;
  window_started_at_utc: string;
};

type QueryCall = Readonly<{
  sql: string;
  timeout?: number;
  values: readonly unknown[];
}>;

function resultHeader(affectedRows: number): ResultSetHeader {
  return {
    affectedRows,
    changedRows: affectedRows,
    fieldCount: 0,
    info: "",
    insertId: 0,
    serverStatus: 0,
    warningStatus: 0,
  } as ResultSetHeader;
}

function createHarness(options: {
  failDatabaseNow?: boolean;
  failMutationNumber?: number;
  nowUtc?: string;
} = {}) {
  let nowUtc = options.nowUtc ?? "2026-09-04 10:00:00.000000";
  let state = new Map<string, StoredRow>();
  let transactionSnapshot: Map<string, StoredRow> | null = null;
  let mutationCount = 0;
  const calls: QueryCall[] = [];

  const query = vi.fn(async (statement: string | { sql: string; timeout?: number; values?: unknown[] }) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const values =
      typeof statement === "string" ? [] : [...(statement.values ?? [])];
    calls.push({
      sql,
      timeout: typeof statement === "string" ? undefined : statement.timeout,
      values,
    });

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
          },
        ],
        [],
      ];
    }
    if (sql.startsWith("SELECT DATE_FORMAT") && sql.includes("UTC_TIMESTAMP(6)")) {
      if (options.failDatabaseNow) {
        throw new Error("database.internal.example:3306 secret detail");
      }
      return [[{ now_utc: nowUtc }], []];
    }
    if (
      sql.startsWith("SELECT bucket_key") &&
      sql.includes("FROM login_attempt_throttle")
    ) {
      const rows = values
        .map((key) => state.get(String(key)))
        .filter((row): row is StoredRow => row !== undefined)
        .sort((left, right) => left.bucket_key.localeCompare(right.bucket_key))
        .map((row) => ({ ...row }));
      return [rows, []];
    }
    if (sql.startsWith("INSERT INTO login_attempt_throttle")) {
      mutationCount += 1;
      if (mutationCount === options.failMutationNumber) {
        throw new Error("mutation detail must be collapsed");
      }
      const [keyValue, typeValue, windowValue, updatedValue] = values;
      const key = String(keyValue);
      if (state.has(key)) {
        throw Object.assign(new Error("duplicate detail"), {
          code: "ER_DUP_ENTRY",
          errno: 1062,
        });
      }
      state.set(key, {
        blocked_until_utc: null,
        bucket_key: key,
        bucket_type: typeValue as StoredRow["bucket_type"],
        failure_count: 1,
        updated_at_utc: String(updatedValue),
        window_started_at_utc: String(windowValue),
      });
      return [resultHeader(1), []];
    }
    if (sql.startsWith("UPDATE login_attempt_throttle")) {
      mutationCount += 1;
      if (mutationCount === options.failMutationNumber) {
        throw new Error("mutation detail must be collapsed");
      }
      const [
        failureCount,
        windowStartedAtUtc,
        blockedUntilUtc,
        updatedAtUtc,
        keyValue,
        typeValue,
      ] = values;
      const key = String(keyValue);
      const row = state.get(key);
      if (!row || row.bucket_type !== typeValue) return [resultHeader(0), []];
      state.set(key, {
        ...row,
        blocked_until_utc:
          blockedUntilUtc === null ? null : String(blockedUntilUtc),
        failure_count: Number(failureCount),
        updated_at_utc: String(updatedAtUtc),
        window_started_at_utc: String(windowStartedAtUtc),
      });
      return [resultHeader(1), []];
    }
    if (
      sql.startsWith("DELETE FROM login_attempt_throttle") &&
      sql.includes("INTERVAL 24 HOUR")
    ) {
      mutationCount += 1;
      if (mutationCount === options.failMutationNumber) {
        throw new Error("mutation detail must be collapsed");
      }
      return [resultHeader(0), []];
    }
    if (sql.startsWith("DELETE FROM login_attempt_throttle")) {
      mutationCount += 1;
      if (mutationCount === options.failMutationNumber) {
        throw new Error("mutation detail must be collapsed");
      }
      const [keyValue, expectedUpdatedAtUtc] = values;
      const key = String(keyValue);
      const row = state.get(key);
      if (
        !row ||
        row.bucket_type !== "account" ||
        row.updated_at_utc !== expectedUpdatedAtUtc
      ) {
        return [resultHeader(0), []];
      }
      state.delete(key);
      return [resultHeader(1), []];
    }
    return [[], []];
  });

  const connection = {
    beginTransaction: vi.fn(async () => {
      transactionSnapshot = new Map(
        [...state].map(([key, row]) => [key, { ...row }]),
      );
    }),
    commit: vi.fn(async () => {
      transactionSnapshot = null;
    }),
    destroy: vi.fn(),
    query,
    release: vi.fn(),
    rollback: vi.fn(async () => {
      if (transactionSnapshot !== null) state = transactionSnapshot;
      transactionSnapshot = null;
    }),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(async () => connection),
  } as unknown as Pool;
  registerMySqlPoolDatabase(pool, databaseName);

  return {
    calls,
    connection,
    pool,
    rows: () => [...state.values()].map((row) => ({ ...row })),
    setNowUtc: (value: string) => {
      nowUtc = value;
    },
    updateRows: (update: (row: StoredRow) => StoredRow) => {
      state = new Map(
        [...state].map(([key, row]) => [key, update({ ...row })]),
      );
    },
  };
}

function rejectedAttempt(
  pool: Pool,
  email: string,
  networkSignal?: string,
) {
  return runLoginAttemptWithThrottle(pool, {
    email,
    networkSignal,
    sessionSecret,
    verify: async () => null,
  });
}

describe("durable login throttling", () => {
  it("stores only domain-separated HMAC keys and always records account plus global", async () => {
    const harness = createHarness();
    const email = "Sensitive.Person@Example.com";
    const networkSignal = "203.0.113.42";

    await expect(
      rejectedAttempt(harness.pool, email, networkSignal),
    ).resolves.toEqual({ status: "rejected" });

    expect(harness.rows().map((row) => row.bucket_type).sort()).toEqual([
      "account",
      "global",
      "network",
    ]);
    const keys = harness.rows().map((row) => row.bucket_key);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^[0-9a-f]{64}$/u),
        expect.stringMatching(/^[0-9a-f]{64}$/u),
        expect.stringMatching(/^[0-9a-f]{64}$/u),
      ]),
    );
    const databasePayload = JSON.stringify(harness.calls);
    expect(databasePayload).not.toContain(email);
    expect(databasePayload).not.toContain(email.toLowerCase());
    expect(databasePayload).not.toContain(networkSignal);
    expect(databasePayload).not.toContain(sessionSecret);
  });

  it("runs index-friendly bounded 24-hour cleanup on the failed-login path", async () => {
    const harness = createHarness();
    await rejectedAttempt(harness.pool, "owner@example.com");

    const cleanup = harness.calls.filter(
      (call) =>
        call.sql.startsWith("DELETE FROM login_attempt_throttle") &&
        call.sql.includes("INTERVAL 24 HOUR"),
    );
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]).toMatchObject({ timeout: 1_000, values: [] });
    expect(cleanup[0]?.sql.replace(/\s+/gu, " ").trim()).toBe(
      "DELETE FROM login_attempt_throttle WHERE updated_at_utc < UTC_TIMESTAMP(6) - INTERVAL 24 HOUR ORDER BY updated_at_utc ASC LIMIT 32",
    );
  });

  it("enforces the account limit before invoking scrypt and releases after 15 minutes", async () => {
    const harness = createHarness();
    for (let attempt = 0; attempt < LOGIN_THROTTLE_POLICY.accountFailureLimit; attempt += 1) {
      await expect(
        rejectedAttempt(harness.pool, "owner@example.com"),
      ).resolves.toEqual({ status: "rejected" });
    }
    const verify = vi.fn(async () => ({ id: "should-not-run" }));
    await expect(
      runLoginAttemptWithThrottle(harness.pool, {
        email: "owner@example.com",
        sessionSecret,
        verify,
      }),
    ).resolves.toEqual({ status: "blocked" });
    expect(verify).not.toHaveBeenCalled();

    harness.setNowUtc("2026-09-04 10:15:00.000000");
    await expect(
      rejectedAttempt(harness.pool, "owner@example.com"),
    ).resolves.toEqual({ status: "rejected" });
    const account = harness.rows().find((row) => row.bucket_type === "account");
    expect(account).toMatchObject({
      blocked_until_utc: null,
      failure_count: 1,
      window_started_at_utc: "2026-09-04 10:15:00.000000",
    });
  });

  it("enforces the best-effort network limit without weakening account/global buckets", async () => {
    const harness = createHarness();
    for (let attempt = 0; attempt < LOGIN_THROTTLE_POLICY.networkFailureLimit; attempt += 1) {
      await expect(
        rejectedAttempt(
          harness.pool,
          `person-${attempt}@example.com`,
          "198.51.100.8",
        ),
      ).resolves.toEqual({ status: "rejected" });
    }
    const verify = vi.fn(async () => ({ id: "blocked-by-network" }));
    await expect(
      runLoginAttemptWithThrottle(harness.pool, {
        email: "new-person@example.com",
        networkSignal: "198.51.100.8",
        sessionSecret,
        verify,
      }),
    ).resolves.toEqual({ status: "blocked" });
    expect(verify).not.toHaveBeenCalled();

    const withoutNetwork = createHarness();
    await rejectedAttempt(
      withoutNetwork.pool,
      "person@example.com",
      "invalid\nsignal",
    );
    expect(withoutNetwork.rows().map((row) => row.bucket_type).sort()).toEqual([
      "account",
      "global",
    ]);
  });

  it("enforces the mandatory global limit across distinct accounts", async () => {
    const harness = createHarness();
    for (let attempt = 0; attempt < LOGIN_THROTTLE_POLICY.globalFailureLimit; attempt += 1) {
      await expect(
        rejectedAttempt(harness.pool, `global-${attempt}@example.com`),
      ).resolves.toEqual({ status: "rejected" });
    }
    const verify = vi.fn(async () => ({ id: "blocked-globally" }));
    await expect(
      runLoginAttemptWithThrottle(harness.pool, {
        email: "fresh@example.com",
        sessionSecret,
        verify,
      }),
    ).resolves.toEqual({ status: "blocked" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("clears only the account bucket after success", async () => {
    const harness = createHarness();
    await rejectedAttempt(harness.pool, "owner@example.com", "192.0.2.5");
    await rejectedAttempt(harness.pool, "owner@example.com", "192.0.2.5");

    await expect(
      runLoginAttemptWithThrottle(harness.pool, {
        email: "OWNER@example.com",
        networkSignal: "192.0.2.5",
        sessionSecret,
        verify: async () => ({ id: "owner" }),
      }),
    ).resolves.toEqual({ status: "authenticated", value: { id: "owner" } });

    expect(harness.rows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket_type: "global", failure_count: 2 }),
        expect.objectContaining({ bucket_type: "network", failure_count: 2 }),
      ]),
    );
    expect(harness.rows().some((row) => row.bucket_type === "account")).toBe(
      false,
    );
  });

  it("preserves a concurrent account failure observed after the pre-scrypt snapshot", async () => {
    const harness = createHarness();
    await rejectedAttempt(harness.pool, "owner@example.com");

    await expect(
      runLoginAttemptWithThrottle(harness.pool, {
        email: "owner@example.com",
        sessionSecret,
        verify: async () => {
          harness.updateRows((row) =>
            row.bucket_type === "account"
              ? {
                  ...row,
                  failure_count: 2,
                  updated_at_utc: "2026-09-04 10:00:01.000000",
                }
              : row,
          );
          return { id: "owner" };
        },
      }),
    ).resolves.toEqual({ status: "authenticated", value: { id: "owner" } });
    expect(
      harness.rows().find((row) => row.bucket_type === "account"),
    ).toMatchObject({ failure_count: 2 });
  });

  it("records all applicable failed buckets in one rollback-safe transaction", async () => {
    const harness = createHarness({ failMutationNumber: 2 });

    await expect(
      rejectedAttempt(harness.pool, "owner@example.com", "203.0.113.9"),
    ).rejects.toEqual(new LoginThrottleUnavailableError());
    expect(harness.rows()).toEqual([]);
    expect(harness.connection.rollback).toHaveBeenCalledOnce();
  });

  it("fails closed with a detail-free error before verification on database failure", async () => {
    const harness = createHarness({ failDatabaseNow: true });
    const verify = vi.fn(async () => ({ id: "owner" }));

    const operation = runLoginAttemptWithThrottle(harness.pool, {
      email: "sensitive@example.com",
      networkSignal: "203.0.113.11",
      sessionSecret,
      verify,
    });
    await expect(operation).rejects.toEqual(new LoginThrottleUnavailableError());
    await expect(operation).rejects.not.toThrow(/sensitive|203\.0\.113|secret|3306/iu);
    expect(verify).not.toHaveBeenCalled();
  });

  it("keeps verifier runtime errors distinct and does not count them as credential failures", async () => {
    const harness = createHarness();
    const verifierError = new Error("safe verifier category");

    await expect(
      runLoginAttemptWithThrottle(harness.pool, {
        email: "owner@example.com",
        sessionSecret,
        verify: async () => {
          throw verifierError;
        },
      }),
    ).rejects.toBe(verifierError);
    expect(harness.rows()).toEqual([]);
  });
});
