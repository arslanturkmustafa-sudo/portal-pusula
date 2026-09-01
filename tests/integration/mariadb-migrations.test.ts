import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysqlCallback, { type Pool as CallbackPool } from "mysql2";
import mysqlPromise, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyMySqlSessionPolicy } from "../../scripts/mysql-session-policy.mjs";
import * as schema from "../../src/platform/db/schema";

const disposableMariaDbEnabled =
  process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const verificationTable = "_platform_migration_verification";
const migrationTable = "__drizzle_migrations";
const cronDispatchGateTable = "cron_dispatch_gate";
const consultingContractTable = "consulting_contract";
const customerTable = "customer";
const monthlyVisitCommitmentTable = "monthly_visit_commitment";
const receivableTable = "receivable";
const receivableCollectionTable = "receivable_collection";
const platformTables = [
  "audit_event",
  "job_run",
  "outbox_event",
  "scheduled_job",
] as const;
const allMigratedPlatformTables = [
  ...platformTables,
  cronDispatchGateTable,
  consultingContractTable,
  customerTable,
  monthlyVisitCommitmentTable,
  receivableTable,
  receivableCollectionTable,
] as const;
const repositoryRoot = process.cwd();
const migrationLockWaitTimeoutMs = 5_000;
const migrationLockPollIntervalMs = 25;

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

interface AdvisoryLockRow extends RowDataPacket {
  lock_result: number | null;
}

interface MigrationRow extends RowDataPacket {
  id: number;
  hash: string;
  created_at: number;
}

interface SqlModeRow extends RowDataPacket {
  global_sql_mode: string;
  session_sql_mode: string;
}

interface TableCountRow extends RowDataPacket {
  table_count: number;
}

interface ShowCreateTableRow extends RowDataPacket {
  "Create Table": string;
}

interface VerificationSnapshotRow extends RowDataPacket {
  decimal_round_trip_value: string;
  idempotency_key: string;
  observed_at_utc: string;
}

interface TableStatusRow extends RowDataPacket {
  Engine: string;
  Collation: string;
  Comment: string;
}

interface ColumnMetadataRow extends RowDataPacket {
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  COLLATION_NAME: string | null;
}

interface IndexMetadataRow extends RowDataPacket {
  INDEX_NAME: string;
  NON_UNIQUE: number;
}

interface PlatformTableStatusRow extends RowDataPacket {
  TABLE_COLLATION: string;
  TABLE_NAME: string;
  ENGINE: string;
}

interface PlatformColumnMetadataRow extends RowDataPacket {
  COLLATION_NAME: string | null;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: "NO" | "YES";
  TABLE_NAME: string;
}

interface PlatformIndexMetadataRow extends RowDataPacket {
  COLUMN_NAME: string;
  INDEX_NAME: string;
  NON_UNIQUE: number;
  SEQ_IN_INDEX: number;
  TABLE_NAME: string;
}

interface PlatformForeignKeyMetadataRow extends RowDataPacket {
  COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
  DELETE_RULE: string;
  REFERENCED_COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  TABLE_NAME: string;
  UPDATE_RULE: string;
}

interface CheckConstraintMetadataRow extends RowDataPacket {
  CHECK_CLAUSE: string;
  CONSTRAINT_NAME: string;
  TABLE_NAME: string;
}

interface MigrationRun {
  completion: Promise<void>;
  hasSettled: () => boolean;
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
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
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

function migrationLockName(): string {
  const databaseDigest = createHash("sha256")
    .update(requiredTestEnvironment("DB_NAME"), "utf8")
    .digest("hex")
    .slice(0, 48);

  return `pp:migrate:${databaseDigest}`;
}

function startMigration(): MigrationRun {
  let settled = false;
  const completion = new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("scripts", "migrate.mjs")], {
      cwd: repositoryRoot,
      env: migrationEnvironment(),
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", () => {
      reject(new Error("Migration runner could not be started."));
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Migration runner failed."));
      }
    });
  });

  void completion.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  return {
    completion,
    hasSettled: () => settled,
  };
}

function runMigration(): Promise<void> {
  return startMigration().completion;
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

async function expectDuplicateRejected(operation: Promise<unknown>): Promise<void> {
  let rejection: unknown;
  try {
    await operation;
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toMatchObject({ code: "ER_DUP_ENTRY", errno: 1062 });
}

async function tableExists(
  connection: Pool | PoolConnection,
  tableName: string,
): Promise<boolean> {
  const [rows] = await connection.execute<TableCountRow[]>(
    `SELECT COUNT(*) AS table_count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );

  return rows[0]?.table_count === 1;
}

async function waitForBlockedMigrationRunners(
  connection: PoolConnection,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + migrationLockWaitTimeoutMs;

  while (Date.now() < deadline) {
    const [rows] = await connection.query<CountRow[]>(
      `SELECT COUNT(*) AS row_count
       FROM information_schema.PROCESSLIST
       WHERE ID <> CONNECTION_ID()
         AND DB = DATABASE()
         AND COMMAND = 'Query'
         AND STATE = 'User lock'
         AND INFO LIKE 'SELECT GET_LOCK(%'`,
    );

    if (Number(rows[0]?.row_count) === expectedCount) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, migrationLockPollIntervalMs);
    });
  }

  throw new Error("Migration runners did not reach the advisory lock.");
}

async function resetKnownMigrationArtifacts(pool: Pool): Promise<void> {
  // These identifiers are compile-time constants and this suite is enabled only
  // for the disposable MariaDB provisioned by scripts/test-mariadb.mjs.
  await pool.query("DROP TABLE IF EXISTS `receivable_collection`");
  await pool.query("DROP TABLE IF EXISTS `receivable`");
  await pool.query("DROP TABLE IF EXISTS `monthly_visit_commitment`");
  await pool.query("DROP TABLE IF EXISTS `consulting_contract`");
  await pool.query("DROP TABLE IF EXISTS `customer`");
  await pool.query("DROP TABLE IF EXISTS `cron_dispatch_gate`");
  await pool.query("DROP TABLE IF EXISTS `job_run`");
  await pool.query("DROP TABLE IF EXISTS `scheduled_job`");
  await pool.query("DROP TABLE IF EXISTS `outbox_event`");
  await pool.query("DROP TABLE IF EXISTS `audit_event`");
  await pool.query(`DROP TABLE IF EXISTS \`${verificationTable}\``);
  await pool.query(`DROP TABLE IF EXISTS \`${migrationTable}\``);
}

describe.skipIf(!disposableMariaDbEnabled).sequential(
  "real MariaDB migration correctness",
  () => {
    let drizzlePool: CallbackPool;
    let pool: Pool;

    beforeAll(async () => {
      const connectionOptions = {
        host: requiredTestEnvironment("DB_HOST"),
        port: Number(requiredTestEnvironment("DB_PORT")),
        database: requiredTestEnvironment("DB_NAME"),
        user: requiredTestEnvironment("DB_USER"),
        password: requiredTestEnvironment("DB_PASSWORD"),
        charset: "utf8mb4",
        timezone: "Z",
        dateStrings: true,
        decimalNumbers: false,
        connectionLimit: 1,
        maxIdle: 1,
        waitForConnections: false,
        connectTimeout: 5_000,
        multipleStatements: false,
      } as const;

      pool = mysqlPromise.createPool(connectionOptions);
      drizzlePool = mysqlCallback.createPool(connectionOptions);

      await pool.query("SET SESSION time_zone = '+00:00'");
    });

    afterAll(async () => {
      await pool?.end();
      await drizzlePool?.promise().end();
    });

    beforeEach(async () => {
      const connection = await pool.getConnection();
      let reusable = false;
      try {
        await applyMySqlSessionPolicy(
          connection,
          requiredTestEnvironment("DB_NAME"),
        );
        reusable = true;
      } finally {
        if (reusable) connection.release();
        else connection.destroy();
      }
    });

    it("rejects journal coercion after inheriting a non-strict provider default", async () => {
      const providerConnection = await mysqlPromise.createConnection({
        host: requiredTestEnvironment("DB_HOST"),
        port: Number(requiredTestEnvironment("DB_PORT")),
        database: requiredTestEnvironment("DB_NAME"),
        user: requiredTestEnvironment("DB_USER"),
        password: requiredTestEnvironment("DB_PASSWORD"),
        charset: "utf8mb4",
        connectTimeout: 5_000,
        multipleStatements: false,
      });
      try {
        const [modeRows] = await providerConnection.query<SqlModeRow[]>(
          `SELECT
             @@GLOBAL.sql_mode AS global_sql_mode,
             @@SESSION.sql_mode AS session_sql_mode`,
        );
        expect(modeRows[0]?.global_sql_mode).not.toMatch(
          /STRICT_(?:ALL|TRANS)_TABLES/u,
        );
        expect(modeRows[0]?.session_sql_mode).not.toMatch(
          /STRICT_(?:ALL|TRANS)_TABLES/u,
        );
      } finally {
        await providerConnection.end();
      }

      await pool.query(
        `CREATE TABLE \`${migrationTable}\` (
           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
           hash VARCHAR(1) NOT NULL,
           created_at BIGINT
         ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      try {
        await expect(runMigration()).rejects.toThrow("Migration runner failed.");

        // The first migration DDL auto-commits before Drizzle records its
        // journal row. A strict runner reaches that insert and rejects the
        // 64-character hash instead of silently truncating it to VARCHAR(1).
        expect(await tableExists(pool, verificationTable)).toBe(true);
        const [journalRows] = await pool.query<CountRow[]>(
          `SELECT COUNT(*) AS row_count FROM \`${migrationTable}\``,
        );
        expect(Number(journalRows[0]?.row_count)).toBe(0);
        for (const tableName of allMigratedPlatformTables) {
          expect(await tableExists(pool, tableName)).toBe(false);
        }
      } finally {
        await resetKnownMigrationArtifacts(pool);
      }
    });

    it("fails closed when an incompatible table pre-exists without a migration journal", async () => {
      const [tablesBefore] = await pool.query<RowDataPacket[]>("SHOW TABLES");
      expect(tablesBefore).toHaveLength(0);

      await pool.query(
        `CREATE TABLE \`${verificationTable}\` (
          \`probe_id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          PRIMARY KEY (\`probe_id\`)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4`,
      );

      try {
        await expect(runMigration()).rejects.toThrow(
          "Migration runner failed.",
        );

        const [columns] = await pool.execute<ColumnMetadataRow[]>(
          `SELECT COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [verificationTable],
        );
        expect(columns.map((column) => column.COLUMN_NAME)).toEqual([
          "probe_id",
        ]);

        if (await tableExists(pool, migrationTable)) {
          const [journalRows] = await pool.query<CountRow[]>(
            `SELECT COUNT(*) AS row_count FROM \`${migrationTable}\``,
          );
          expect(journalRows[0]?.row_count).toBe(0);
        }
      } finally {
        await resetKnownMigrationArtifacts(pool);
      }
    });

    it("migrates a clean database with the intended storage contract", async () => {
      const [tablesBefore] = await pool.query<RowDataPacket[]>("SHOW TABLES");
      expect(tablesBefore).toHaveLength(0);

      await runMigration();

      const [statusRows] = await pool.execute<TableStatusRow[]>(
        `SELECT ENGINE AS Engine,
                TABLE_COLLATION AS Collation,
                TABLE_COMMENT AS Comment
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [verificationTable],
      );
      expect(statusRows).toHaveLength(1);
      expect(statusRows[0]).toMatchObject({
        Engine: "InnoDB",
        Collation: "utf8mb4_unicode_ci",
        Comment: "Platform verification only; not customer or finance data",
      });

      const [columns] = await pool.execute<ColumnMetadataRow[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [verificationTable],
      );
      const columnMetadata = Object.fromEntries(
        columns.map((column) => [
          column.COLUMN_NAME,
          {
            type: column.COLUMN_TYPE,
            collation: column.COLLATION_NAME,
          },
        ]),
      );
      expect(columnMetadata).toMatchObject({
        decimal_round_trip_value: { type: "decimal(19,4)" },
        idempotency_key: {
          type: "varchar(128)",
          collation: "utf8mb4_bin",
        },
        observed_at_utc: { type: "timestamp(6)" },
      });

      const [indexes] = await pool.execute<IndexMetadataRow[]>(
        `SELECT INDEX_NAME, NON_UNIQUE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [verificationTable],
      );
      expect(indexes).toContainEqual(
        expect.objectContaining({
          INDEX_NAME: "uq_platform_migration_verification_idempotency",
          NON_UNIQUE: 0,
        }),
      );
    });

    it("creates the complete schema and preserves the core platform metadata contracts", async () => {
      const [tableRows] = await pool.query<RowDataPacket[]>("SHOW TABLES");
      expect(tableRows).toHaveLength(12);

      const [statusRows] = await pool.execute<PlatformTableStatusRow[]>(
        `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('audit_event', 'job_run', 'outbox_event', 'scheduled_job')
         ORDER BY TABLE_NAME`,
      );
      expect(statusRows).toHaveLength(platformTables.length);
      for (const row of statusRows) {
        expect(row.ENGINE, row.TABLE_NAME).toBe("InnoDB");
        expect(row.TABLE_COLLATION, row.TABLE_NAME).toBe(
          "utf8mb4_unicode_ci",
        );
      }

      const [columnRows] = await pool.execute<PlatformColumnMetadataRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('audit_event', 'job_run', 'outbox_event', 'scheduled_job')
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      );
      const columnNamesByTable = Object.groupBy(
        columnRows,
        (row) => row.TABLE_NAME,
      );
      expect(
        columnNamesByTable.audit_event?.map((row) => row.COLUMN_NAME),
      ).toEqual([
        "id",
        "actor_type",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "before_summary",
        "after_summary",
        "correlation_id",
        "occurred_at_utc",
      ]);
      expect(columnNamesByTable.job_run?.map((row) => row.COLUMN_NAME)).toEqual(
        [
          "id",
          "job_id",
          "attempt_no",
          "lease_token",
          "lease_owner",
          "started_at_utc",
          "completed_at_utc",
          "outcome",
          "correlation_id",
          "error_code",
        ],
      );
      expect(
        columnNamesByTable.outbox_event?.map((row) => row.COLUMN_NAME),
      ).toEqual([
        "id",
        "event_type",
        "schema_version",
        "payload",
        "idempotency_key",
        "available_at_utc",
        "status",
        "attempt_count",
        "max_attempts",
        "lease_owner",
        "lease_token",
        "lease_expires_at_utc",
        "delivered_at_utc",
        "last_error_code",
        "created_at_utc",
        "updated_at_utc",
      ]);
      expect(
        columnNamesByTable.scheduled_job?.map((row) => row.COLUMN_NAME),
      ).toEqual([
        "id",
        "job_type",
        "payload_schema_version",
        "payload",
        "scheduled_at_utc",
        "available_at_utc",
        "status",
        "attempt_count",
        "max_attempts",
        "lease_owner",
        "lease_token",
        "lease_expires_at_utc",
        "idempotency_key",
        "last_error_code",
        "created_at_utc",
        "updated_at_utc",
      ]);

      const columnByQualifiedName = new Map(
        columnRows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]),
      );
      const asciiBinaryColumns = [
        "audit_event.id",
        "audit_event.actor_type",
        "audit_event.actor_id",
        "audit_event.action",
        "audit_event.entity_type",
        "audit_event.entity_id",
        "audit_event.correlation_id",
        "job_run.id",
        "job_run.job_id",
        "job_run.lease_token",
        "job_run.lease_owner",
        "job_run.outcome",
        "job_run.correlation_id",
        "job_run.error_code",
        "outbox_event.id",
        "outbox_event.event_type",
        "outbox_event.idempotency_key",
        "outbox_event.status",
        "outbox_event.lease_owner",
        "outbox_event.lease_token",
        "outbox_event.last_error_code",
        "scheduled_job.id",
        "scheduled_job.job_type",
        "scheduled_job.status",
        "scheduled_job.lease_owner",
        "scheduled_job.lease_token",
        "scheduled_job.idempotency_key",
        "scheduled_job.last_error_code",
      ];
      for (const qualifiedName of asciiBinaryColumns) {
        expect(
          columnByQualifiedName.get(qualifiedName)?.COLLATION_NAME,
          qualifiedName,
        ).toBe("ascii_bin");
      }

      const utcDateTimeColumns = columnRows.filter((row) =>
        row.COLUMN_NAME.endsWith("_at_utc"),
      );
      expect(utcDateTimeColumns).toHaveLength(13);
      for (const column of utcDateTimeColumns) {
        expect(
          column.COLUMN_TYPE,
          `${column.TABLE_NAME}.${column.COLUMN_NAME}`,
        ).toBe("datetime(6)");
      }

      expect(
        columnByQualifiedName.get("scheduled_job.payload_schema_version"),
      ).toMatchObject({
        COLUMN_TYPE: expect.stringMatching(/^int(?:\(10\))? unsigned$/u),
        IS_NULLABLE: "NO",
      });
      expect(
        columnByQualifiedName.get("outbox_event.schema_version"),
      ).toMatchObject({
        COLUMN_TYPE: expect.stringMatching(/^int(?:\(10\))? unsigned$/u),
        IS_NULLABLE: "NO",
      });
      for (const qualifiedName of [
        "scheduled_job.attempt_count",
        "scheduled_job.max_attempts",
        "job_run.attempt_no",
        "outbox_event.attempt_count",
        "outbox_event.max_attempts",
      ]) {
        expect(
          columnByQualifiedName.get(qualifiedName)?.COLUMN_TYPE,
          qualifiedName,
        ).toMatch(/^smallint(?:\(5\))? unsigned$/u);
      }

      const [indexRows] = await pool.execute<PlatformIndexMetadataRow[]>(
        `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('audit_event', 'job_run', 'outbox_event', 'scheduled_job')
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      );
      const indexes = new Map<
        string,
        { columns: string[]; unique: boolean }
      >();
      for (const row of indexRows) {
        const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
        const current = indexes.get(key) ?? {
          columns: [],
          unique: row.NON_UNIQUE === 0,
        };
        current.columns.push(row.COLUMN_NAME);
        indexes.set(key, current);
      }

      expect(Object.fromEntries(indexes)).toEqual({
        "audit_event.PRIMARY": { columns: ["id"], unique: true },
        "audit_event.idx_audit_event_correlation_occurred": {
          columns: ["correlation_id", "occurred_at_utc"],
          unique: false,
        },
        "audit_event.idx_audit_event_entity_occurred": {
          columns: ["entity_type", "entity_id", "occurred_at_utc"],
          unique: false,
        },
        "job_run.PRIMARY": { columns: ["id"], unique: true },
        "job_run.idx_job_run_correlation_started": {
          columns: ["correlation_id", "started_at_utc"],
          unique: false,
        },
        "job_run.idx_job_run_job_started": {
          columns: ["job_id", "started_at_utc"],
          unique: false,
        },
        "job_run.uq_job_run_job_attempt": {
          columns: ["job_id", "attempt_no"],
          unique: true,
        },
        "outbox_event.PRIMARY": { columns: ["id"], unique: true },
        "outbox_event.idx_outbox_event_claim_expired": {
          columns: ["status", "lease_expires_at_utc", "id"],
          unique: false,
        },
        "outbox_event.idx_outbox_event_claim_ready": {
          columns: ["status", "available_at_utc", "id"],
          unique: false,
        },
        "outbox_event.uq_outbox_event_idempotency": {
          columns: ["idempotency_key"],
          unique: true,
        },
        "outbox_event.uq_outbox_event_lease_token": {
          columns: ["lease_token"],
          unique: true,
        },
        "scheduled_job.PRIMARY": { columns: ["id"], unique: true },
        "scheduled_job.idx_scheduled_job_claim_expired": {
          columns: ["status", "lease_expires_at_utc", "id"],
          unique: false,
        },
        "scheduled_job.idx_scheduled_job_claim_ready": {
          columns: ["status", "available_at_utc", "id"],
          unique: false,
        },
        "scheduled_job.uq_scheduled_job_lease_token": {
          columns: ["lease_token"],
          unique: true,
        },
        "scheduled_job.uq_scheduled_job_type_idempotency": {
          columns: ["job_type", "idempotency_key"],
          unique: true,
        },
      });

      const [foreignKeyRows] =
        await pool.execute<PlatformForeignKeyMetadataRow[]>(
          `SELECT kcu.TABLE_NAME,
                  kcu.CONSTRAINT_NAME,
                  kcu.COLUMN_NAME,
                  kcu.REFERENCED_TABLE_NAME,
                  kcu.REFERENCED_COLUMN_NAME,
                  rc.DELETE_RULE,
                  rc.UPDATE_RULE
           FROM information_schema.KEY_COLUMN_USAGE AS kcu
           INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
             ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
            AND rc.TABLE_NAME = kcu.TABLE_NAME
            AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
           WHERE kcu.TABLE_SCHEMA = DATABASE()
             AND kcu.TABLE_NAME IN ('audit_event', 'job_run', 'outbox_event', 'scheduled_job')
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
        );
      expect(foreignKeyRows).toEqual([
        expect.objectContaining({
          COLUMN_NAME: "job_id",
          CONSTRAINT_NAME: "fk_job_run_scheduled_job",
          DELETE_RULE: "RESTRICT",
          REFERENCED_COLUMN_NAME: "id",
          REFERENCED_TABLE_NAME: "scheduled_job",
          TABLE_NAME: "job_run",
          UPDATE_RULE: "RESTRICT",
        }),
      ]);

      for (const [tableName, jsonColumns] of [
        ["audit_event", ["before_summary", "after_summary"]],
        ["outbox_event", ["payload"]],
        ["scheduled_job", ["payload"]],
      ] as const) {
        const [createRows] = await pool.query<ShowCreateTableRow[]>(
          `SHOW CREATE TABLE \`${tableName}\``,
        );
        const createSql = createRows[0]?.["Create Table"] ?? "";
        for (const columnName of jsonColumns) {
          expect(createSql, `${tableName}.${columnName}`).toMatch(
            new RegExp(
              `\`${columnName}\`[\\s\\S]*?json_valid\\(\`${columnName}\`\\)`,
              "iu",
            ),
          );
        }
      }
    });

    it("creates the durable cron gate with its exact storage and check contracts", async () => {
      const [statusRows] = await pool.execute<PlatformTableStatusRow[]>(
        `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [cronDispatchGateTable],
      );
      expect(statusRows).toEqual([
        expect.objectContaining({
          ENGINE: "InnoDB",
          TABLE_COLLATION: "utf8mb4_unicode_ci",
          TABLE_NAME: cronDispatchGateTable,
        }),
      ]);

      const [columnRows] = await pool.execute<PlatformColumnMetadataRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
        [cronDispatchGateTable],
      );
      expect(columnRows.map((row) => row.COLUMN_NAME)).toEqual([
        "gate_key",
        "state",
        "last_permitted_at_utc",
        "created_at_utc",
        "updated_at_utc",
      ]);
      expect(columnRows[0]?.COLLATION_NAME).toBe("ascii_bin");
      expect(columnRows[1]?.COLLATION_NAME).toBe("ascii_bin");
      for (const row of columnRows.slice(2)) {
        expect(row.COLUMN_TYPE, row.COLUMN_NAME).toBe("datetime(6)");
        expect(row.IS_NULLABLE, row.COLUMN_NAME).toBe("NO");
      }

      const [indexRows] = await pool.execute<PlatformIndexMetadataRow[]>(
        `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [cronDispatchGateTable],
      );
      expect(indexRows).toEqual([
        expect.objectContaining({
          COLUMN_NAME: "gate_key",
          INDEX_NAME: "PRIMARY",
          NON_UNIQUE: 0,
        }),
      ]);

      const [checkRows] = await pool.execute<CheckConstraintMetadataRow[]>(
        `SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
           FROM information_schema.TABLE_CONSTRAINTS AS tc
           INNER JOIN information_schema.CHECK_CONSTRAINTS AS cc
             ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
            AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
          WHERE tc.TABLE_SCHEMA = DATABASE()
            AND tc.TABLE_NAME = ?
            AND tc.CONSTRAINT_TYPE = 'CHECK'
          ORDER BY cc.CONSTRAINT_NAME`,
        [cronDispatchGateTable],
      );
      expect(checkRows.map((row) => row.CONSTRAINT_NAME)).toEqual([
        "chk_cron_dispatch_gate_key_format",
        "chk_cron_dispatch_gate_state",
        "chk_cron_dispatch_gate_timeline",
      ]);
    });

    it("records the immutable 0000 through 0006 migration hash chain", async () => {
      const [rows] = await pool.query<MigrationRow[]>(
        `SELECT id, hash, created_at FROM \`${migrationTable}\` ORDER BY id`,
      );
      expect(rows).toEqual([
        {
          created_at: 1788107612321,
          hash: "3fdcdcd582fc0c2002948f6f3d5b1993b117bccc5fb2581714e932c0575a65a8",
          id: 1,
        },
        {
          created_at: 1788112845060,
          hash: "a113ac3d3d40cb4017d7a8a9406f4cc4d568e274f22d2d4e5577e11fd4635cce",
          id: 2,
        },
        {
          created_at: 1788116023820,
          hash: "b2a4f6a5c53f9e48b300467045c03f9e602f58a0ab33572dc315fff173b2952c",
          id: 3,
        },
        {
          created_at: 1788117573101,
          hash: "42b92645038c4f436b0ea88c544f0859ef016f8e04e4c10f3b547ec0cf6e51bd",
          id: 4,
        },
        {
          created_at: 1788262397356,
          hash: "8027aef0d0c48a6c29d806a45c7e074a50ea7cf890dc1a40786c0f3b63bf0dc5",
          id: 5,
        },
        {
          created_at: 1788265670001,
          hash: "33b7926be1645c3367dd5c8a7db79ee7aea78391331d457dc694624e68264a4b",
          id: 6,
        },
        {
          created_at: 1788282029501,
          hash: "a54ad41d2a07f01c4d4042b56cdf5d4d78668f193d4cb14103914121f0485ee5",
          id: 7,
        },
      ]);
    });

    it("registers the complete enforced CHECK constraint set", async () => {
      const [rows] = await pool.execute<CheckConstraintMetadataRow[]>(
        `SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
         FROM information_schema.TABLE_CONSTRAINTS AS tc
         INNER JOIN information_schema.CHECK_CONSTRAINTS AS cc
           ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
          AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         WHERE tc.TABLE_SCHEMA = DATABASE()
           AND tc.TABLE_NAME IN ('audit_event', 'job_run', 'outbox_event', 'scheduled_job')
           AND tc.CONSTRAINT_TYPE = 'CHECK'
           AND tc.CONSTRAINT_NAME LIKE 'chk%'
         ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME`,
      );

      expect(rows.map((row) => `${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`)).toEqual(
        [
          "audit_event.chk_audit_event_actor_type",
          "audit_event.chk_audit_event_identity_format",
          "job_run.chk_job_run_identity_format",
          "job_run.chk_job_run_outcome_state",
          "outbox_event.chk_outbox_event_attempt_bounds",
          "outbox_event.chk_outbox_event_identity_format",
          "outbox_event.chk_outbox_event_lease_shape",
          "outbox_event.chk_outbox_event_status",
          "scheduled_job.chk_scheduled_job_attempt_bounds",
          "scheduled_job.chk_scheduled_job_identity_format",
          "scheduled_job.chk_scheduled_job_lease_shape",
          "scheduled_job.chk_scheduled_job_status",
        ],
      );
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.CHECK_CLAUSE.length, row.CONSTRAINT_NAME).toBeGreaterThan(5);
      }
    });

    it("accepts canonical direct SQL and rejects invalid state and identity writes", async () => {
      const scheduledId = "a0000000-b000-4c00-8d00-000000000001";
      const outboxId = "b0000000-c000-4d00-8e00-000000000002";
      const runId = "c0000000-d000-4e00-8f00-000000000003";
      const leaseToken = "d0000000-e000-4f00-8a00-000000000004";
      const auditId = "e0000000-f000-4a00-8b00-000000000005";
      const entityId = "f0000000-a000-4b00-8c00-000000000006";
      const actorId = "a1111111-b111-4c11-8d11-111111111111";
      const instant = "2026-08-30 10:00:00.000000";

      await pool.execute(
        `INSERT INTO scheduled_job
           (id, job_type, payload_schema_version, payload, scheduled_at_utc,
            available_at_utc, status, attempt_count, max_attempts,
            idempotency_key, created_at_utc, updated_at_utc)
         VALUES (?, 'platform.verification.v1', 1, '{}', ?, ?, 'pending', 0, 2,
                 'direct-job-key', ?, ?)`,
        [scheduledId, instant, instant, instant, instant],
      );
      await pool.execute(
        `INSERT INTO outbox_event
           (id, event_type, schema_version, payload, idempotency_key,
            available_at_utc, status, attempt_count, max_attempts,
            created_at_utc, updated_at_utc)
         VALUES (?, 'platform.verification.completed.v1', 1, '{}',
                 'direct-outbox-key', ?, 'pending', 0, 2, ?, ?)`,
        [outboxId, instant, instant, instant],
      );
      await pool.execute(
        `INSERT INTO audit_event
           (id, actor_type, actor_id, action, entity_type, entity_id,
            before_summary, after_summary, correlation_id, occurred_at_utc)
         VALUES (?, 'system', NULL, 'platform.verification.completed',
                 'platform_job', ?, NULL, '{}', 'correlation-direct', ?)`,
        [auditId, entityId, instant],
      );

      await expectDuplicateRejected(
        pool.execute(
          `INSERT INTO scheduled_job
             (id, job_type, payload_schema_version, payload, scheduled_at_utc,
              available_at_utc, status, attempt_count, max_attempts,
              idempotency_key, created_at_utc, updated_at_utc)
           VALUES ('a2222222-b222-4c22-8d22-222222222222',
                   'platform.verification.v1', 1, '{}', ?, ?, 'pending', 0, 2,
                   'direct-job-key', ?, ?)`,
          [instant, instant, instant, instant],
        ),
      );
      await expectDuplicateRejected(
        pool.execute(
          `INSERT INTO outbox_event
             (id, event_type, schema_version, payload, idempotency_key,
              available_at_utc, status, attempt_count, max_attempts,
              created_at_utc, updated_at_utc)
           VALUES ('b2222222-c222-4d22-8e22-222222222222',
                   'platform.verification.completed.v1', 1, '{}',
                   'direct-outbox-key', ?, 'pending', 0, 2, ?, ?)`,
          [instant, instant, instant],
        ),
      );

      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET max_attempts = 0 WHERE id = ?", [
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(
          "UPDATE scheduled_job SET attempt_count = 3 WHERE id = ?",
          [scheduledId],
        ),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET status = 'unknown' WHERE id = ?", [
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET status = 'leased' WHERE id = ?", [
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(
          `UPDATE scheduled_job
           SET lease_owner = 'worker', lease_token = ?, lease_expires_at_utc = ?
           WHERE id = ?`,
          [leaseToken, instant, scheduledId],
        ),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET id = ? WHERE id = ?", [
          scheduledId.toUpperCase(),
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET id = ? WHERE id = ?", [
          `${scheduledId.slice(0, -1)} `,
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET id = ? WHERE id = ?", [
          `ğ${scheduledId.slice(1)}`,
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET id = ? WHERE id = ?", [
          scheduledId.replace("-4c00-", "-0c00-"),
          scheduledId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE scheduled_job SET id = ? WHERE id = ?", [
          scheduledId.replace("-8d00-", "-0d00-"),
          scheduledId,
        ]),
      );
      for (const invalidKey of ["bad key", "bad-key ", "anahtar-ğ"]) {
        await expectDatabaseWriteRejected(
          pool.execute(
            "UPDATE scheduled_job SET idempotency_key = ? WHERE id = ?",
            [invalidKey, scheduledId],
          ),
        );
      }

      await expectDatabaseWriteRejected(
        pool.execute("UPDATE outbox_event SET max_attempts = 0 WHERE id = ?", [
          outboxId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE outbox_event SET attempt_count = 3 WHERE id = ?", [
          outboxId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE outbox_event SET status = 'unknown' WHERE id = ?", [
          outboxId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE outbox_event SET status = 'leased' WHERE id = ?", [
          outboxId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(
          `UPDATE outbox_event
           SET lease_owner = 'worker', lease_token = ?, lease_expires_at_utc = ?
           WHERE id = ?`,
          [leaseToken, instant, outboxId],
        ),
      );
      await expectDatabaseWriteRejected(
        pool.execute(
          "UPDATE outbox_event SET idempotency_key = 'bad key' WHERE id = ?",
          [outboxId],
        ),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE outbox_event SET id = ? WHERE id = ?", [
          outboxId.toUpperCase(),
          outboxId,
        ]),
      );

      await pool.execute(
        `INSERT INTO job_run
           (id, job_id, attempt_no, lease_token, lease_owner, started_at_utc,
            completed_at_utc, outcome, correlation_id, error_code)
         VALUES (?, ?, 1, ?, 'worker-direct', ?, NULL, 'running',
                 'correlation-direct', NULL)`,
        [runId, scheduledId, leaseToken, instant],
      );

      await expectDatabaseWriteRejected(
        pool.execute("UPDATE job_run SET outcome = 'unknown' WHERE id = ?", [
          runId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE job_run SET outcome = 'succeeded' WHERE id = ?", [
          runId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE job_run SET completed_at_utc = ? WHERE id = ?", [
          instant,
          runId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE job_run SET lease_token = ? WHERE id = ?", [
          `${leaseToken.slice(0, -1)} `,
          runId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE job_run SET id = ? WHERE id = ?", [
          runId.toUpperCase(),
          runId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute(
          "UPDATE job_run SET correlation_id = 'bad correlation' WHERE id = ?",
          [runId],
        ),
      );

      await expectDatabaseWriteRejected(
        pool.execute("UPDATE audit_event SET actor_type = 'service' WHERE id = ?", [
          auditId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE audit_event SET id = ? WHERE id = ?", [
          auditId.toUpperCase(),
          auditId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE audit_event SET actor_id = ? WHERE id = ?", [
          `${actorId.slice(0, -1)} `,
          auditId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE audit_event SET entity_id = ? WHERE id = ?", [
          `ğ${entityId.slice(1)}`,
          auditId,
        ]),
      );
      await expectDatabaseWriteRejected(
        pool.execute("UPDATE audit_event SET action = 'bad action' WHERE id = ?", [
          auditId,
        ]),
      );

      expect(await tableExists(pool, "scheduled_job")).toBe(true);
      const [validCounts] = await pool.query<CountRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM scheduled_job) +
           (SELECT COUNT(*) FROM job_run) +
           (SELECT COUNT(*) FROM outbox_event) +
           (SELECT COUNT(*) FROM audit_event) AS row_count`,
      );
      expect(Number(validCounts[0]?.row_count)).toBe(4);
    });

    it("is a no-op when the migration runner is invoked a second time", async () => {
      const [before] = await pool.query<MigrationRow[]>(
        `SELECT id, hash, created_at FROM \`${migrationTable}\` ORDER BY id`,
      );
      expect(before).toHaveLength(7);

      await runMigration();

      const [after] = await pool.query<MigrationRow[]>(
        `SELECT id, hash, created_at FROM \`${migrationTable}\` ORDER BY id`,
      );
      expect(after).toEqual(before);
    });

    it("rejects an applied migration hash mismatch without changing schema or data", async () => {
      const [migrationRows] = await pool.query<MigrationRow[]>(
        `SELECT id, hash, created_at FROM \`${migrationTable}\` ORDER BY id`,
      );
      expect(migrationRows).toHaveLength(7);
      const migration = migrationRows[3];
      if (migration === undefined) {
        throw new Error("Expected the fourth applied migration journal row.");
      }

      await pool.execute(
        `INSERT INTO \`${verificationTable}\`
           (idempotency_key, decimal_round_trip_value, observed_at_utc)
         VALUES (?, ?, ?)`,
        ["hash-integrity-proof", "404.1250", "2026-08-30 10:00:00.000000"],
      );

      const [createBeforeRows] = await pool.query<ShowCreateTableRow[]>(
        `SHOW CREATE TABLE \`${verificationTable}\``,
      );
      const [dataBefore] = await pool.execute<VerificationSnapshotRow[]>(
        `SELECT idempotency_key,
                CAST(decimal_round_trip_value AS CHAR) AS decimal_round_trip_value,
                DATE_FORMAT(observed_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS observed_at_utc
         FROM \`${verificationTable}\`
         WHERE idempotency_key = ?`,
        ["hash-integrity-proof"],
      );
      const tamperedHash = "0".repeat(64);

      try {
        await pool.execute(
          `UPDATE \`${migrationTable}\` SET hash = ? WHERE id = ?`,
          [tamperedHash, migration.id],
        );

        await expect(runMigration()).rejects.toThrow(
          "Migration runner failed.",
        );

        const [createAfterRows] = await pool.query<ShowCreateTableRow[]>(
          `SHOW CREATE TABLE \`${verificationTable}\``,
        );
        const [dataAfter] = await pool.execute<VerificationSnapshotRow[]>(
          `SELECT idempotency_key,
                  CAST(decimal_round_trip_value AS CHAR) AS decimal_round_trip_value,
                  DATE_FORMAT(observed_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS observed_at_utc
           FROM \`${verificationTable}\`
           WHERE idempotency_key = ?`,
          ["hash-integrity-proof"],
        );
        const [journalAfter] = await pool.query<MigrationRow[]>(
          `SELECT id, hash, created_at FROM \`${migrationTable}\` ORDER BY id`,
        );

        expect(createAfterRows).toEqual(createBeforeRows);
        expect(dataAfter).toEqual(dataBefore);
        expect(journalAfter).toEqual(
          migrationRows.map((row) =>
            row.id === migration.id ? { ...row, hash: tamperedHash } : row,
          ),
        );
      } finally {
        await pool.execute(
          `UPDATE \`${migrationTable}\` SET hash = ? WHERE id = ?`,
          [migration.hash, migration.id],
        );
        await pool.execute(
          `DELETE FROM \`${verificationTable}\` WHERE idempotency_key = ?`,
          ["hash-integrity-proof"],
        );
      }
    });

    it(
      "serializes two concurrent runners and records the migration exactly once",
      async () => {
        await resetKnownMigrationArtifacts(pool);
        const lockName = migrationLockName();
        const lockConnection = await pool.getConnection();
        const migrations: MigrationRun[] = [];
        let lockHeld = false;
        let assertionsCompleted = false;

        try {
          expect(lockName.length).toBeLessThanOrEqual(64);

          const [lockRows] = await lockConnection.execute<AdvisoryLockRow[]>(
            "SELECT GET_LOCK(?, 0) AS lock_result",
            [lockName],
          );
          expect(Number(lockRows[0]?.lock_result)).toBe(1);
          lockHeld = true;

          migrations.push(startMigration(), startMigration());
          await waitForBlockedMigrationRunners(lockConnection, migrations.length);

          expect(migrations.every((migration) => !migration.hasSettled())).toBe(
            true,
          );
          expect(await tableExists(lockConnection, migrationTable)).toBe(false);
          expect(await tableExists(lockConnection, verificationTable)).toBe(
            false,
          );
          for (const tableName of allMigratedPlatformTables) {
            expect(await tableExists(lockConnection, tableName)).toBe(false);
          }

          const [releaseRows] =
            await lockConnection.execute<AdvisoryLockRow[]>(
              "SELECT RELEASE_LOCK(?) AS lock_result",
              [lockName],
            );
          expect(Number(releaseRows[0]?.lock_result)).toBe(1);
          lockHeld = false;

          await Promise.all(
            migrations.map((migration) => migration.completion),
          );

          const [journalRows] = await lockConnection.query<MigrationRow[]>(
            `SELECT id, hash, created_at FROM \`${migrationTable}\` ORDER BY id`,
          );
          expect(journalRows).toHaveLength(7);
          expect(await tableExists(lockConnection, verificationTable)).toBe(
            true,
          );
          for (const tableName of allMigratedPlatformTables) {
            expect(await tableExists(lockConnection, tableName)).toBe(true);
          }

          const [verificationTableCount] =
            await lockConnection.execute<TableCountRow[]>(
              `SELECT COUNT(*) AS table_count
               FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
              [verificationTable],
            );
          expect(verificationTableCount[0]?.table_count).toBe(1);
          assertionsCompleted = true;
        } finally {
          let releaseConnection = true;

          if (lockHeld) {
            try {
              const [releaseRows] =
                await lockConnection.execute<AdvisoryLockRow[]>(
                  "SELECT RELEASE_LOCK(?) AS lock_result",
                  [lockName],
                );
              releaseConnection = Number(releaseRows[0]?.lock_result) === 1;
            } catch {
              releaseConnection = false;
            }
          }

          if (releaseConnection) {
            lockConnection.release();
          } else {
            // Closing the physical session is the fail-safe for a failed
            // RELEASE_LOCK call because MariaDB drops its advisory locks.
            lockConnection.destroy();
          }

          await Promise.allSettled(
            migrations.map((migration) => migration.completion),
          );

          if (!assertionsCompleted) {
            await resetKnownMigrationArtifacts(pool);
          }
        }
      },
      20_000,
    );

    it("persists a transaction only after commit", async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `INSERT INTO \`${verificationTable}\`
             (idempotency_key, decimal_round_trip_value, observed_at_utc)
           VALUES (?, ?, ?)`,
          ["commit-proof", "101.2500", "2026-08-30 10:00:00.000000"],
        );
        await connection.commit();
      } finally {
        connection.release();
      }

      const [rows] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS row_count FROM \`${verificationTable}\`
         WHERE idempotency_key = ?`,
        ["commit-proof"],
      );
      expect(rows[0]?.row_count).toBe(1);
    });

    it("leaves no row after transaction rollback", async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `INSERT INTO \`${verificationTable}\`
             (idempotency_key, decimal_round_trip_value, observed_at_utc)
           VALUES (?, ?, ?)`,
          ["rollback-proof", "202.5000", "2026-08-30 10:00:00.000000"],
        );
        await connection.rollback();
      } finally {
        connection.release();
      }

      const [rows] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS row_count FROM \`${verificationTable}\`
         WHERE idempotency_key = ?`,
        ["rollback-proof"],
      );
      expect(rows[0]?.row_count).toBe(0);
    });

    it("round-trips DECIMAL(19,4) without converting through JS number", async () => {
      const exactValue = "900719925474099.1234";
      const database = drizzle<typeof schema>(drizzlePool, {
        logger: false,
        mode: "default",
        schema,
      });

      await database.insert(schema.platformMigrationVerification).values({
        idempotencyKey: "decimal-proof",
        decimalRoundTripValue: exactValue,
        observedAtUtc: "2026-08-30 10:00:00.000000",
      });

      const rows = await database
        .select({ value: schema.platformMigrationVerification.decimalRoundTripValue })
        .from(schema.platformMigrationVerification)
        .where(
          eq(schema.platformMigrationVerification.idempotencyKey, "decimal-proof"),
        );
      const returnedValue = rows[0]?.value;

      if (typeof returnedValue !== "string") {
        throw new Error("MariaDB did not return DECIMAL as a string.");
      }

      expect(returnedValue).toBe(exactValue);
      expect(new Decimal(returnedValue).equals(new Decimal(exactValue))).toBe(
        true,
      );
    });

    it("lets the database unique constraint reject a duplicate idempotency key", async () => {
      const duplicateInsert = `INSERT INTO \`${verificationTable}\`
        (idempotency_key, decimal_round_trip_value, observed_at_utc)
        VALUES (?, ?, ?)`;
      await pool.execute(duplicateInsert, [
        "unique-proof",
        "1.0000",
        "2026-08-30 10:00:00.000000",
      ]);

      await expect(
        pool.execute(duplicateInsert, [
          "unique-proof",
          "2.0000",
          "2026-08-30 10:00:00.000000",
        ]),
      ).rejects.toMatchObject({
        code: "ER_DUP_ENTRY",
        errno: 1062,
      });
    });

    it("normalizes TIMESTAMP(6) writes and reads as UTC", async () => {
      const connection = await pool.getConnection();
      try {
        await connection.query("SET SESSION time_zone = '+03:00'");
        await connection.execute(
          `INSERT INTO \`${verificationTable}\`
             (idempotency_key, decimal_round_trip_value, observed_at_utc)
           VALUES (?, ?, ?)`,
          ["utc-proof", "3.0000", "2026-08-30 15:34:56.123456"],
        );

        await connection.query("SET SESSION time_zone = '+00:00'");
        const [rows] = await connection.execute<
          (RowDataPacket & { observed_at_utc: string })[]
        >(
          `SELECT DATE_FORMAT(observed_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS observed_at_utc
           FROM \`${verificationTable}\`
           WHERE idempotency_key = ?`,
          ["utc-proof"],
        );

        expect(rows[0]?.observed_at_utc).toBe(
          "2026-08-30 12:34:56.123456",
        );
      } finally {
        await connection.query("SET SESSION time_zone = '+00:00'");
        connection.release();
      }
    });
  },
);
