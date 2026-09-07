import { spawn } from "node:child_process";
import path from "node:path";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  LOGIN_THROTTLE_POLICY,
  LoginThrottleUnavailableError,
  runLoginAttemptWithThrottle,
} from "../../src/platform/auth/login-throttle";
import { registerMySqlPoolDatabase } from "../../src/platform/database/mysql-session-contract";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const sessionSecret = "AbcdEFgh12345678";

const safeEnvironmentKeys = [
  "APPDATA",
  "CI",
  "CommonProgramFiles",
  "FORCE_COLOR",
  "HOME",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "Path",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramW6432",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
] as const;

interface ThrottleRow extends RowDataPacket {
  bucket_key: string;
  bucket_type: string;
  failure_count: number;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!enabled || typeof value !== "string" || value === "") {
    throw new Error("Disposable MariaDB test environment is incomplete.");
  }
  return value;
}

function migrationEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of safeEnvironmentKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  for (const key of [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
  ] as const) {
    environment[key] = requiredEnvironment(key);
  }
  return environment;
}

function runMigration(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("scripts", "migrate.mjs")], {
      cwd: repositoryRoot,
      env: migrationEnvironment(),
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => reject(new Error("Migration runner did not start.")));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Migration runner failed."));
    });
  });
}

function createPool(): Pool {
  const pool = mysql.createPool({
    host: requiredEnvironment("DB_HOST"),
    port: Number(requiredEnvironment("DB_PORT")),
    database: requiredEnvironment("DB_NAME"),
    user: requiredEnvironment("DB_USER"),
    password: requiredEnvironment("DB_PASSWORD"),
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    connectionLimit: 2,
    maxIdle: 2,
    waitForConnections: true,
    connectTimeout: 5_000,
    multipleStatements: false,
  });
  registerMySqlPoolDatabase(pool, requiredEnvironment("DB_NAME"));
  return pool;
}

function rejectedAttempt(pool: Pool, email: string) {
  return runLoginAttemptWithThrottle(pool, {
    email,
    sessionSecret,
    verify: async () => null,
  });
}

describe.skipIf(!enabled).sequential(
  "durable login throttling on real MariaDB",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      await runMigration();
      pool = createPool();
    });

    beforeEach(async () => {
      await pool.query("DELETE FROM login_attempt_throttle");
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("persists the account block across independent pool instances", async () => {
      const verify = vi.fn(async () => null);
      for (
        let attempt = 0;
        attempt < LOGIN_THROTTLE_POLICY.accountFailureLimit;
        attempt += 1
      ) {
        await expect(
          runLoginAttemptWithThrottle(pool, {
            email: "durable@example.test",
            sessionSecret,
            verify,
          }),
        ).resolves.toEqual({ status: "rejected" });
      }

      const restartedPool = createPool();
      try {
        await expect(
          runLoginAttemptWithThrottle(restartedPool, {
            email: "durable@example.test",
            sessionSecret,
            verify,
          }),
        ).resolves.toEqual({ status: "blocked" });
        expect(verify).toHaveBeenCalledTimes(
          LOGIN_THROTTLE_POLICY.accountFailureLimit,
        );
      } finally {
        await restartedPool.end();
      }
    });

    it("atomically retains two racing failures without storing identity data", async () => {
      const firstPool = createPool();
      const secondPool = createPool();
      try {
        await expect(
          Promise.all([
            rejectedAttempt(firstPool, "race@example.test"),
            rejectedAttempt(secondPool, "race@example.test"),
          ]),
        ).resolves.toEqual([
          { status: "rejected" },
          { status: "rejected" },
        ]);

        const [rows] = await pool.query<ThrottleRow[]>(
          `SELECT bucket_key, bucket_type, failure_count
             FROM login_attempt_throttle
            ORDER BY bucket_type`,
        );
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.bucket_type)).toEqual([
          "account",
          "global",
        ]);
        expect(rows.every((row) => row.failure_count === 2)).toBe(true);
        const serialized = JSON.stringify(rows);
        expect(serialized).not.toContain("race@example.test");
        expect(serialized).not.toContain(sessionSecret);
        expect(rows.every((row) => /^[0-9a-f]{64}$/u.test(row.bucket_key))).toBe(
          true,
        );
      } finally {
        await firstPool.end();
        await secondPool.end();
      }
    });

    it("clears only the account evidence after a successful credential check", async () => {
      await expect(
        rejectedAttempt(pool, "success@example.test"),
      ).resolves.toEqual({ status: "rejected" });

      await expect(
        runLoginAttemptWithThrottle(pool, {
          email: "success@example.test",
          sessionSecret,
          verify: async () => ({ accountId: "safe-test-id" }),
        }),
      ).resolves.toEqual({
        status: "authenticated",
        value: { accountId: "safe-test-id" },
      });

      const [rows] = await pool.query<ThrottleRow[]>(
        `SELECT bucket_key, bucket_type, failure_count
           FROM login_attempt_throttle
          ORDER BY bucket_type`,
      );
      expect(rows.map((row) => row.bucket_type)).toEqual(["global"]);
    });

    it("fails closed without exposing input or database diagnostics", async () => {
      const unavailablePool = createPool();
      await unavailablePool.end();

      let rejection: unknown;
      try {
        await rejectedAttempt(unavailablePool, "sensitive@example.test");
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toEqual(new LoginThrottleUnavailableError());
      const serialized = JSON.stringify(rejection, Object.getOwnPropertyNames(rejection));
      expect(serialized).not.toContain("sensitive@example.test");
      expect(serialized).not.toContain(sessionSecret);
    });
  },
);
