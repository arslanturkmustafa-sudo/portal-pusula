import { spawn } from "node:child_process";
import path from "node:path";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimScheduledJobs,
  completeClaimedJob,
  enqueueCatchUpWindows,
  enqueueScheduledJob,
  executeClaimedJob,
  MAX_CATCH_UP_WINDOWS,
  type Clock,
  type JobHandler,
  type JobRegistry,
} from "../../src/platform/jobs";
import {
  claimOutboxEvents,
  completeOutboxDelivery,
  dispatchOutboxBatch,
  enqueueOutboxEventUsingPool,
  recordOutboxFailure,
  type OutboxAdapter,
} from "../../src/platform/outbox";
import { appendAuditEvent } from "../../src/platform/audit";
import { PlatformInputError } from "../../src/platform/validation/canonical-identifiers";
import {
  createVerificationJobHandler,
  VERIFICATION_EVENT_TYPE,
  VERIFICATION_JOB_TYPE,
} from "../support/platform-verification-handler";

const disposableMariaDbEnabled =
  process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const backoffPolicy = Object.freeze({
  baseDelayMs: 1_000,
  maximumDelayMs: 8_000,
});

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

interface JobStateRow extends RowDataPacket {
  attempt_count: number;
  available_at_utc: string;
  last_error_code: string | null;
  status: string;
}

interface JobRunStateRow extends RowDataPacket {
  attempt_no: number;
  completed_at_utc: string | null;
  error_code: string | null;
  outcome: string;
}

interface OutboxStateRow extends RowDataPacket {
  attempt_count: number;
  last_error_code: string | null;
  status: string;
}

class MutableClock implements Clock {
  #instant: Date;

  constructor(instant: string) {
    this.#instant = new Date(instant);
  }

  now = (): Date => new Date(this.#instant.getTime());

  set(instant: string): void {
    this.#instant = new Date(instant);
  }
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

function verificationJobInput(idempotencyKey: string, maxAttempts = 3) {
  return {
    availableAtUtc: "2026-08-30 10:00:00.000000",
    idempotencyKey,
    jobType: VERIFICATION_JOB_TYPE,
    maxAttempts,
    payload: { verification: true },
    payloadSchemaVersion: 1,
    scheduledAtUtc: "2026-08-30 10:00:00.000000",
  } as const;
}

async function countRows(pool: Pool, tableName: string): Promise<number> {
  const allowedTables = new Set([
    "audit_event",
    "job_run",
    "outbox_event",
    "scheduled_job",
  ]);
  if (!allowedTables.has(tableName)) throw new Error("Unknown test table.");
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS row_count FROM \`${tableName}\``,
  );
  return Number(rows[0]?.row_count);
}

describe.skipIf(!disposableMariaDbEnabled).sequential(
  "real MariaDB job, outbox, and audit engine",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      await runMigration();
      pool = mysql.createPool({
        host: requiredTestEnvironment("DB_HOST"),
        port: Number(requiredTestEnvironment("DB_PORT")),
        database: requiredTestEnvironment("DB_NAME"),
        user: requiredTestEnvironment("DB_USER"),
        password: requiredTestEnvironment("DB_PASSWORD"),
        charset: "utf8mb4",
        timezone: "Z",
        dateStrings: true,
        decimalNumbers: false,
        connectionLimit: 8,
        maxIdle: 8,
        waitForConnections: true,
        connectTimeout: 5_000,
        multipleStatements: false,
      });
    });

    beforeEach(async () => {
      await pool.query("DELETE FROM job_run");
      await pool.query("DELETE FROM audit_event");
      await pool.query("DELETE FROM outbox_event");
      await pool.query("DELETE FROM scheduled_job");
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("enforces job idempotency and bounded duplicate-free catch-up windows", async () => {
      const first = await enqueueScheduledJob(
        pool,
        verificationJobInput("same-window"),
      );
      const duplicate = await enqueueScheduledJob(
        pool,
        verificationJobInput("same-window"),
      );
      expect(first.inserted).toBe(true);
      expect(duplicate).toEqual({ id: first.id, inserted: false });
      expect(await countRows(pool, "scheduled_job")).toBe(1);

      const clock = new MutableClock("2026-08-30T10:37:00.000Z");
      const catchUpInput = {
        clock,
        idempotencyPrefix: "verification-window",
        intervalMs: 60 * 60 * 1_000,
        jobType: VERIFICATION_JOB_TYPE,
        maxAttempts: 2,
        maxWindows: 3,
        payloadForWindow: (window: {
          endAtUtc: string;
          startAtUtc: string;
        }) => window,
        payloadSchemaVersion: 1,
      } as const;
      expect(await enqueueCatchUpWindows(pool, catchUpInput)).toEqual({
        inserted: 3,
        windows: 3,
      });
      expect(await enqueueCatchUpWindows(pool, catchUpInput)).toEqual({
        inserted: 0,
        windows: 3,
      });
      expect(await countRows(pool, "scheduled_job")).toBe(4);

      await expect(
        enqueueCatchUpWindows(pool, {
          ...catchUpInput,
          maxWindows: MAX_CATCH_UP_WINDOWS + 1,
        }),
      ).rejects.toThrow("Catch-up limits are invalid.");
    });

    it("enforces maxAttempts at both application enqueue boundaries", async () => {
      for (const invalid of [0, -1, 1.5, 65_536]) {
        await expect(
          enqueueScheduledJob(
            pool,
            verificationJobInput(`job-attempts-${String(invalid)}`, invalid),
          ),
        ).rejects.toBeInstanceOf(PlatformInputError);
        await expect(
          enqueueOutboxEventUsingPool(pool, {
            availableAtUtc: "2026-08-30 10:00:00.000000",
            eventType: VERIFICATION_EVENT_TYPE,
            idempotencyKey: `outbox-attempts-${String(invalid)}`,
            maxAttempts: invalid,
            payload: { verification: true },
            schemaVersion: 1,
          }),
        ).rejects.toBeInstanceOf(PlatformInputError);
      }

      await expect(
        enqueueScheduledJob(pool, verificationJobInput("job-attempts-1", 1)),
      ).resolves.toMatchObject({ inserted: true });
      await expect(
        enqueueOutboxEventUsingPool(pool, {
          availableAtUtc: "2026-08-30 10:00:00.000000",
          eventType: VERIFICATION_EVENT_TYPE,
          idempotencyKey: "outbox-attempts-65535",
          maxAttempts: 65_535,
          payload: { verification: true },
          schemaVersion: 1,
        }),
      ).resolves.toMatchObject({ inserted: true });
    });

    it("accepts only canonical ASCII keys and lowercase UUID inputs", async () => {
      const invalidKeys = [
        " leading",
        "trailing ",
        "internal space",
        "tab\tkey",
        "ünicode",
      ];
      for (const [index, invalidKey] of invalidKeys.entries()) {
        await expect(
          enqueueScheduledJob(pool, {
            ...verificationJobInput(invalidKey),
            id: `018f1f6e-7b2a-7cc1-8d43-2db5d3a2f${String(index).padStart(2, "0")}`,
          }),
        ).rejects.toBeInstanceOf(PlatformInputError);
        await expect(
          enqueueOutboxEventUsingPool(pool, {
            availableAtUtc: "2026-08-30 10:00:00.000000",
            eventType: VERIFICATION_EVENT_TYPE,
            idempotencyKey: invalidKey,
            maxAttempts: 1,
            payload: { verification: true },
            schemaVersion: 1,
          }),
        ).rejects.toBeInstanceOf(PlatformInputError);
      }

      await expect(
        enqueueScheduledJob(pool, {
          ...verificationJobInput("invalid-job-type"),
          jobType: "platform job",
        }),
      ).rejects.toBeInstanceOf(PlatformInputError);
      await expect(
        enqueueOutboxEventUsingPool(pool, {
          availableAtUtc: "2026-08-30 10:00:00.000000",
          eventType: "platform event",
          idempotencyKey: "invalid-event-type",
          maxAttempts: 1,
          payload: { verification: true },
          schemaVersion: 1,
        }),
      ).rejects.toBeInstanceOf(PlatformInputError);

      for (const invalidId of [
        "018F1F6E-7B2A-7CC1-8D43-2DB5D3A2FE17",
        "018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe17 ",
        "not-a-uuid",
      ]) {
        await expect(
          enqueueScheduledJob(pool, {
            ...verificationJobInput(`job-id-${invalidId.length}`),
            id: invalidId,
          }),
        ).rejects.toBeInstanceOf(PlatformInputError);
        await expect(
          enqueueOutboxEventUsingPool(pool, {
            availableAtUtc: "2026-08-30 10:00:00.000000",
            eventType: VERIFICATION_EVENT_TYPE,
            id: invalidId,
            idempotencyKey: `outbox-id-${invalidId.length}`,
            maxAttempts: 1,
            payload: { verification: true },
            schemaVersion: 1,
          }),
        ).rejects.toBeInstanceOf(PlatformInputError);
      }

      const canonicalJobId = "018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe17";
      const first = await enqueueScheduledJob(pool, {
        ...verificationJobInput("canonical-duplicate"),
        id: canonicalJobId,
      });
      const duplicate = await enqueueScheduledJob(pool, {
        ...verificationJobInput("canonical-duplicate"),
        id: "018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe18",
      });
      expect(first).toEqual({ id: canonicalJobId, inserted: true });
      expect(duplicate).toEqual({ id: canonicalJobId, inserted: false });

      const connection = await pool.getConnection();
      try {
        await expect(
          appendAuditEvent(connection, {
            action: "platform.canonical.accepted",
            actorId: "018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe1b",
            actorType: "system",
            correlationId: "canonical-correlation",
            entityId: canonicalJobId,
            entityType: "platform_job",
            id: "018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe1a",
            occurredAtUtc: "2026-08-30 10:00:00.000000",
          }),
        ).resolves.toBe("018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe1a");
        await expect(
          appendAuditEvent(connection, {
            action: "platform.canonical.rejected",
            actorId: "018F1F6E-7B2A-7CC1-8D43-2DB5D3A2FE1B",
            actorType: "system",
            correlationId: "canonical-correlation",
            entityId: canonicalJobId,
            entityType: "platform_job",
            occurredAtUtc: "2026-08-30 10:00:00.000000",
          }),
        ).rejects.toBeInstanceOf(PlatformInputError);
      } finally {
        connection.release();
      }
    });

    it("allows only one of two concurrent workers to own a job", async () => {
      await enqueueScheduledJob(pool, verificationJobInput("concurrency"));
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      const outcomes = await Promise.allSettled([
        claimScheduledJobs(pool, {
          batchSize: 1,
          clock,
          correlationId: "correlation-a",
          leaseDurationMs: 5_000,
          leaseOwner: "worker-a",
        }),
        claimScheduledJobs(pool, {
          batchSize: 1,
          clock,
          correlationId: "correlation-b",
          leaseDurationMs: 5_000,
          leaseOwner: "worker-b",
        }),
      ]);

      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(
        true,
      );
      const [first, second] = outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      );

      expect((first?.length ?? 0) + (second?.length ?? 0)).toBe(1);
      expect(await countRows(pool, "job_run")).toBe(1);
      const [rows] = await pool.query<JobStateRow[]>(
        "SELECT status, attempt_count, available_at_utc, last_error_code FROM scheduled_job",
      );
      expect(rows[0]).toMatchObject({ attempt_count: 1, status: "leased" });
    });

    it("commits one job result, one audit, and one outbox event atomically", async () => {
      await enqueueScheduledJob(pool, verificationJobInput("success"));
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      const [job] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-success",
        leaseDurationMs: 5_000,
        leaseOwner: "worker-success",
      });
      if (job === undefined) throw new Error("Expected a claimed job.");

      const registry: JobRegistry = new Map([
        [VERIFICATION_JOB_TYPE, createVerificationJobHandler()],
      ]);
      expect(
        await executeClaimedJob(pool, job, {
          backoffPolicy,
          clock,
          registry,
        }),
      ).toBe("succeeded");

      expect(await countRows(pool, "scheduled_job")).toBe(1);
      expect(await countRows(pool, "job_run")).toBe(1);
      expect(await countRows(pool, "audit_event")).toBe(1);
      expect(await countRows(pool, "outbox_event")).toBe(1);
      const [jobRows] = await pool.query<JobStateRow[]>(
        "SELECT status, attempt_count, available_at_utc, last_error_code FROM scheduled_job",
      );
      expect(jobRows[0]).toMatchObject({
        attempt_count: 1,
        last_error_code: null,
        status: "succeeded",
      });
      const [runRows] = await pool.query<JobRunStateRow[]>(
        "SELECT attempt_no, outcome, error_code FROM job_run",
      );
      expect(runRows).toEqual([
        expect.objectContaining({
          attempt_no: 1,
          error_code: null,
          outcome: "succeeded",
        }),
      ]);
    });

    it("reclaims an expired lease while fencing the stale worker", async () => {
      await enqueueScheduledJob(pool, verificationJobInput("lease", 3));
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      const [staleJob] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-stale",
        leaseDurationMs: 1_000,
        leaseOwner: "worker-stale",
      });
      if (staleJob === undefined) throw new Error("Expected first lease.");

      clock.set("2026-08-30T10:00:01.001Z");
      const [currentJob] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-current",
        leaseDurationMs: 1_000,
        leaseOwner: "worker-current",
      });
      if (currentJob === undefined) throw new Error("Expected reclaimed lease.");

      expect(currentJob.leaseToken).not.toBe(staleJob.leaseToken);
      expect(await completeClaimedJob(pool, staleJob, clock)).toBe("stale");
      expect(await completeClaimedJob(pool, currentJob, clock)).toBe(
        "succeeded",
      );
      const [runRows] = await pool.query<JobRunStateRow[]>(
        "SELECT attempt_no, outcome, error_code FROM job_run ORDER BY attempt_no",
      );
      expect(runRows).toEqual([
        expect.objectContaining({
          attempt_no: 1,
          error_code: "lease_expired",
          outcome: "lease_expired",
        }),
        expect.objectContaining({
          attempt_no: 2,
          error_code: null,
          outcome: "succeeded",
        }),
      ]);
    });

    it("closes the running history before dead-lettering an exhausted expired lease", async () => {
      await enqueueScheduledJob(pool, verificationJobInput("crashed-final", 1));
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      const [crashedJob] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-crashed-final",
        leaseDurationMs: 1_000,
        leaseOwner: "worker-crashed-final",
      });
      if (crashedJob === undefined) throw new Error("Expected final lease.");

      clock.set("2026-08-30T10:00:01.001Z");
      await expect(
        claimScheduledJobs(pool, {
          batchSize: 1,
          clock,
          correlationId: "correlation-expiry-sweep",
          leaseDurationMs: 1_000,
          leaseOwner: "worker-expiry-sweep",
        }),
      ).resolves.toEqual([]);

      const [jobRows] = await pool.query<JobStateRow[]>(
        "SELECT status, attempt_count, available_at_utc, last_error_code FROM scheduled_job",
      );
      expect(jobRows[0]).toMatchObject({
        attempt_count: 1,
        last_error_code: "lease_expired",
        status: "dead_letter",
      });
      const [runRows] = await pool.query<JobRunStateRow[]>(
        "SELECT attempt_no, completed_at_utc, outcome, error_code FROM job_run",
      );
      expect(runRows[0]).toMatchObject({
        attempt_no: 1,
        error_code: "lease_expired",
        outcome: "lease_expired",
      });
      expect(runRows[0]?.completed_at_utc).not.toBeNull();
    });

    it("fails closed when exhausted lease history is missing", async () => {
      await enqueueScheduledJob(pool, verificationJobInput("missing-history", 1));
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      const [crashedJob] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-missing-history",
        leaseDurationMs: 1_000,
        leaseOwner: "worker-missing-history",
      });
      if (crashedJob === undefined) throw new Error("Expected final lease.");
      await pool.execute("DELETE FROM job_run WHERE job_id = ?", [crashedJob.id]);

      clock.set("2026-08-30T10:00:01.001Z");
      await expect(
        claimScheduledJobs(pool, {
          batchSize: 1,
          clock,
          correlationId: "correlation-missing-sweep",
          leaseDurationMs: 1_000,
          leaseOwner: "worker-missing-sweep",
        }),
      ).rejects.toThrow("Exhausted job run history is invalid.");

      const [jobRows] = await pool.query<JobStateRow[]>(
        "SELECT status, attempt_count, available_at_utc, last_error_code FROM scheduled_job",
      );
      expect(jobRows[0]).toMatchObject({
        attempt_count: 1,
        last_error_code: null,
        status: "leased",
      });
      expect(await countRows(pool, "job_run")).toBe(0);
    });

    it("rolls handler effects back, waits for backoff, and then dead-letters safely", async () => {
      const rawSentinel = "raw-customer-secret-must-never-persist";
      await enqueueScheduledJob(pool, verificationJobInput("failure", 2));
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      const baseHandler = createVerificationJobHandler();
      const failingHandler: JobHandler = async (context) => {
        await baseHandler(context);
        throw new Error(rawSentinel);
      };
      const registry: JobRegistry = new Map([
        [VERIFICATION_JOB_TYPE, failingHandler],
      ]);

      const [firstAttempt] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-failure",
        leaseDurationMs: 5_000,
        leaseOwner: "worker-failure",
      });
      if (firstAttempt === undefined) throw new Error("Expected first attempt.");
      expect(
        await executeClaimedJob(pool, firstAttempt, {
          backoffPolicy,
          clock,
          registry,
        }),
      ).toBe("retry");
      expect(await countRows(pool, "audit_event")).toBe(0);
      expect(await countRows(pool, "outbox_event")).toBe(0);

      clock.set("2026-08-30T10:00:00.999Z");
      expect(
        await claimScheduledJobs(pool, {
          batchSize: 1,
          clock,
          correlationId: "too-early",
          leaseDurationMs: 5_000,
          leaseOwner: "worker-too-early",
        }),
      ).toEqual([]);

      clock.set("2026-08-30T10:00:01.000Z");
      const [secondAttempt] = await claimScheduledJobs(pool, {
        batchSize: 1,
        clock,
        correlationId: "correlation-failure-2",
        leaseDurationMs: 5_000,
        leaseOwner: "worker-failure-2",
      });
      if (secondAttempt === undefined) throw new Error("Expected retry attempt.");
      expect(
        await executeClaimedJob(pool, secondAttempt, {
          backoffPolicy,
          clock,
          registry,
        }),
      ).toBe("dead_letter");

      const [jobRows] = await pool.query<JobStateRow[]>(
        "SELECT status, attempt_count, available_at_utc, last_error_code FROM scheduled_job",
      );
      expect(jobRows[0]).toMatchObject({
        attempt_count: 2,
        last_error_code: "unexpected_error",
        status: "dead_letter",
      });
      const [runRows] = await pool.query<JobRunStateRow[]>(
        "SELECT attempt_no, outcome, error_code FROM job_run ORDER BY attempt_no",
      );
      expect(runRows.map((row) => row.outcome)).toEqual([
        "retry",
        "dead_letter",
      ]);
      expect(JSON.stringify({ jobRows, runRows })).not.toContain(rawSentinel);
      expect(await countRows(pool, "audit_event")).toBe(0);
      expect(await countRows(pool, "outbox_event")).toBe(0);
    });

    it("relies on adapter idempotency after an effect succeeds before marking", async () => {
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      await enqueueOutboxEventUsingPool(pool, {
        availableAtUtc: "2026-08-30 10:00:00.000000",
        eventType: VERIFICATION_EVENT_TYPE,
        idempotencyKey: "delivery-effect-once",
        maxAttempts: 3,
        payload: { verification: true },
        schemaVersion: 1,
      });

      const effects = new Set<string>();
      let calls = 0;
      const adapter: OutboxAdapter = {
        deliver: async ({ idempotencyKey }) => {
          calls += 1;
          if (!effects.has(idempotencyKey)) effects.add(idempotencyKey);
          if (calls === 1) {
            throw new Error("raw-adapter-error-after-effect");
          }
        },
      };
      const adapters = new Map([[VERIFICATION_EVENT_TYPE, adapter]]);

      expect(
        await dispatchOutboxBatch(pool, {
          adapters,
          backoffPolicy,
          batchSize: 1,
          clock,
          leaseDurationMs: 1_000,
          leaseOwner: "outbox-worker",
        }),
      ).toMatchObject({ claimed: 1, retried: 1 });
      expect(effects.size).toBe(1);

      clock.set("2026-08-30T10:00:00.999Z");
      expect(
        await dispatchOutboxBatch(pool, {
          adapters,
          backoffPolicy,
          batchSize: 1,
          clock,
          leaseDurationMs: 1_000,
          leaseOwner: "outbox-worker",
        }),
      ).toMatchObject({ claimed: 0 });

      clock.set("2026-08-30T10:00:01.000Z");
      expect(
        await dispatchOutboxBatch(pool, {
          adapters,
          backoffPolicy,
          batchSize: 1,
          clock,
          leaseDurationMs: 1_000,
          leaseOwner: "outbox-worker",
        }),
      ).toMatchObject({ claimed: 1, delivered: 1 });
      expect(calls).toBe(2);
      expect(effects.size).toBe(1);
      const [rows] = await pool.query<OutboxStateRow[]>(
        "SELECT status, attempt_count, last_error_code FROM outbox_event",
      );
      expect(rows[0]).toMatchObject({
        attempt_count: 2,
        last_error_code: null,
        status: "delivered",
      });
      expect(JSON.stringify(rows)).not.toContain("raw-adapter-error-after-effect");
    });

    it("allows only one of two concurrent workers to own an outbox event", async () => {
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      await enqueueOutboxEventUsingPool(pool, {
        availableAtUtc: "2026-08-30 10:00:00.000000",
        eventType: VERIFICATION_EVENT_TYPE,
        idempotencyKey: "outbox-concurrency",
        maxAttempts: 3,
        payload: { verification: true },
        schemaVersion: 1,
      });

      const outcomes = await Promise.allSettled([
        claimOutboxEvents(pool, {
          batchSize: 1,
          clock,
          leaseDurationMs: 5_000,
          leaseOwner: "outbox-worker-a",
        }),
        claimOutboxEvents(pool, {
          batchSize: 1,
          clock,
          leaseDurationMs: 5_000,
          leaseOwner: "outbox-worker-b",
        }),
      ]);
      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(
        true,
      );
      const claims = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      );
      expect(claims).toHaveLength(1);
      const [rows] = await pool.query<OutboxStateRow[]>(
        "SELECT status, attempt_count, last_error_code FROM outbox_event",
      );
      expect(rows[0]).toMatchObject({
        attempt_count: 1,
        last_error_code: null,
        status: "leased",
      });
    });

    it("fences stale outbox delivery and dead-letters the exhausted lease", async () => {
      const clock = new MutableClock("2026-08-30T10:00:00.000Z");
      await enqueueOutboxEventUsingPool(pool, {
        availableAtUtc: "2026-08-30 10:00:00.000000",
        eventType: VERIFICATION_EVENT_TYPE,
        idempotencyKey: "outbox-stale",
        maxAttempts: 2,
        payload: { verification: true },
        schemaVersion: 1,
      });
      const [staleEvent] = await claimOutboxEvents(pool, {
        batchSize: 1,
        clock,
        leaseDurationMs: 1_000,
        leaseOwner: "outbox-stale-worker",
      });
      if (staleEvent === undefined) throw new Error("Expected outbox lease.");

      clock.set("2026-08-30T10:00:01.001Z");
      const [currentEvent] = await claimOutboxEvents(pool, {
        batchSize: 1,
        clock,
        leaseDurationMs: 1_000,
        leaseOwner: "outbox-current-worker",
      });
      if (currentEvent === undefined) throw new Error("Expected outbox reclaim.");

      expect(await completeOutboxDelivery(pool, staleEvent, clock)).toBe(
        "stale",
      );
      expect(
        await recordOutboxFailure(pool, currentEvent, {
          backoffPolicy,
          clock,
          errorCode: "delivery_failed",
        }),
      ).toBe("dead_letter");
      const [rows] = await pool.query<OutboxStateRow[]>(
        "SELECT status, attempt_count, last_error_code FROM outbox_event",
      );
      expect(rows[0]).toMatchObject({
        attempt_count: 2,
        last_error_code: "delivery_failed",
        status: "dead_letter",
      });
    });
  },
);
