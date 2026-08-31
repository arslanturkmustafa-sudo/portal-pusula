import { spawn } from "node:child_process";
import path from "node:path";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acquireCronDispatchPermit,
  CronDispatchGateError,
} from "../../src/platform/cron/cron-dispatch-gate-repository";

const disposableMariaDbEnabled =
  process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const gateKey = "platform-cron-dispatch-v1";

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

interface CountRow extends RowDataPacket {
  row_count: number;
}

interface GateRow extends RowDataPacket {
  last_permitted_at_utc: string;
  state: string;
}

function requiredTestEnvironment(name: string): string {
  const value = process.env[name];
  if (!disposableMariaDbEnabled || typeof value !== "string" || value === "") {
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
    environment[key] = requiredTestEnvironment(key);
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
  return mysql.createPool({
    host: requiredTestEnvironment("DB_HOST"),
    port: Number(requiredTestEnvironment("DB_PORT")),
    database: requiredTestEnvironment("DB_NAME"),
    user: requiredTestEnvironment("DB_USER"),
    password: requiredTestEnvironment("DB_PASSWORD"),
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    connectionLimit: 1,
    maxIdle: 1,
    waitForConnections: true,
    connectTimeout: 5_000,
    multipleStatements: false,
  });
}

async function expectDatabaseWriteRejected(
  operation: Promise<unknown>,
): Promise<void> {
  let rejection: unknown;
  try {
    await operation;
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeDefined();
}

describe.skipIf(!disposableMariaDbEnabled).sequential(
  "durable cron dispatch gate on real MariaDB",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      await runMigration();
      pool = createPool();
      await pool.query("SET SESSION time_zone = '+00:00'");
    });

    beforeEach(async () => {
      await pool.query("DELETE FROM cron_dispatch_gate");
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("permits first use, suppresses inside the window, and permits at the boundary", async () => {
      await expect(
        acquireCronDispatchPermit(pool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => new Date("2026-08-30T10:00:00.000Z"),
        }),
      ).resolves.toBe("permit");
      await expect(
        acquireCronDispatchPermit(pool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => new Date("2026-08-30T10:00:59.999Z"),
        }),
      ).resolves.toBe("suppressed");
      await expect(
        acquireCronDispatchPermit(pool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => new Date("2026-08-30T10:01:00.000Z"),
        }),
      ).resolves.toBe("permit");

      const [rows] = await pool.execute<GateRow[]>(
        `SELECT state,
                DATE_FORMAT(last_permitted_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS last_permitted_at_utc
           FROM cron_dispatch_gate WHERE gate_key = ?`,
        [gateKey],
      );
      expect(rows).toEqual([
        expect.objectContaining({
          last_permitted_at_utc: "2026-08-30 10:01:00.000000",
          state: "active",
        }),
      ]);
    });

    it("grants exactly one permit when two independent pools race", async () => {
      const firstPool = createPool();
      const secondPool = createPool();
      const instant = new Date("2026-08-30T11:00:00.000Z");
      const dispatch = vi.fn();
      const acquireAndDispatch = async (candidatePool: Pool) => {
        const decision = await acquireCronDispatchPermit(candidatePool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => instant,
        });
        if (decision === "permit") dispatch();
        return decision;
      };
      try {
        const decisions = await Promise.all([
          acquireAndDispatch(firstPool),
          acquireAndDispatch(secondPool),
        ]);

        expect(decisions.sort()).toEqual(["permit", "suppressed"]);
        expect(dispatch).toHaveBeenCalledOnce();
        const [counts] = await pool.execute<CountRow[]>(
          "SELECT COUNT(*) AS row_count FROM cron_dispatch_gate WHERE gate_key = ?",
          [gateKey],
        );
        expect(Number(counts[0]?.row_count)).toBe(1);
      } finally {
        await firstPool.end();
        await secondPool.end();
      }
    });

    it("preserves the window across a repository pool restart", async () => {
      const firstPool = createPool();
      await expect(
        acquireCronDispatchPermit(firstPool, {
          gateKey,
          minimumIntervalSeconds: 300,
          now: () => new Date("2026-08-30T12:00:00.000Z"),
        }),
      ).resolves.toBe("permit");
      await firstPool.end();

      const restartedPool = createPool();
      try {
        await expect(
          acquireCronDispatchPermit(restartedPool, {
            gateKey,
            minimumIntervalSeconds: 300,
            now: () => new Date("2026-08-30T12:04:59.999Z"),
          }),
        ).resolves.toBe("suppressed");
      } finally {
        await restartedPool.end();
      }
    });

    it("honors persisted DATETIME(6) precision without permitting early", async () => {
      const lastPermit = "2026-08-30 12:30:00.999500";
      await pool.execute(
        `INSERT INTO cron_dispatch_gate
          (gate_key, state, last_permitted_at_utc, created_at_utc, updated_at_utc)
         VALUES (?, 'active', ?, ?, ?)`,
        [gateKey, lastPermit, lastPermit, lastPermit],
      );

      await expect(
        acquireCronDispatchPermit(pool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => new Date("2026-08-30T12:31:00.999Z"),
        }),
      ).resolves.toBe("suppressed");
      await expect(
        acquireCronDispatchPermit(pool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => new Date("2026-08-30T12:31:01.000Z"),
        }),
      ).resolves.toBe("permit");
    });

    it("fails closed with a generic error when the database pool is unavailable", async () => {
      const unavailablePool = createPool();
      await unavailablePool.end();

      await expect(
        acquireCronDispatchPermit(unavailablePool, {
          gateKey,
          minimumIntervalSeconds: 60,
          now: () => new Date("2026-08-30T13:00:00.000Z"),
        }),
      ).rejects.toEqual(new CronDispatchGateError());
    });

    it("rejects invalid direct SQL state, key, and timestamp relationships", async () => {
      const validInsert = `INSERT INTO cron_dispatch_gate
        (gate_key, state, last_permitted_at_utc, created_at_utc, updated_at_utc)
        VALUES (?, ?, ?, ?, ?)`;
      const instant = "2026-08-30 14:00:00.000000";

      await pool.execute(validInsert, [gateKey, "active", instant, instant, instant]);

      for (const invalidKey of [
        "",
        " leading-key",
        "trailing-key ",
        "internal key",
        "tab\tkey",
        "unicode-ğ",
      ]) {
        await expectDatabaseWriteRejected(
          pool.execute(validInsert, [
            invalidKey,
            "active",
            instant,
            instant,
            instant,
          ]),
        );
      }

      await expectDatabaseWriteRejected(
        pool.execute(validInsert, [
          "bad-state-key",
          "paused",
          instant,
          instant,
          instant,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(validInsert, [
          "padded-state-key",
          "active ",
          instant,
          instant,
          instant,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(validInsert, [
          "bad-created-timeline",
          "active",
          instant,
          "2026-08-30 14:00:01.000000",
          instant,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(validInsert, [
          "bad-updated-timeline",
          "active",
          instant,
          instant,
          "2026-08-30 14:00:01.000000",
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(validInsert, [
          "bad-datetime-value",
          "active",
          "not-a-timestamp",
          instant,
          instant,
        ]),
      );
      await expect(
        pool.execute(validInsert, [gateKey, "active", instant, instant, instant]),
      ).rejects.toMatchObject({ code: "ER_DUP_ENTRY", errno: 1062 });

      const [counts] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS row_count FROM cron_dispatch_gate",
      );
      expect(Number(counts[0]?.row_count)).toBe(1);
    });
  },
);
