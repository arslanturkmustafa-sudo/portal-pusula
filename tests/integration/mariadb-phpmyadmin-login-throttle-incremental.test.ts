import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error Deployment artifact builders are intentionally plain Node ESM.
import { buildPhpMyAdminIncrementalMigrationBundle as untypedBuildIncremental } from "../../scripts/build-phpmyadmin-incremental-migration.mjs";
// @ts-expect-error The migration integrity contract is intentionally plain Node ESM.
import { readExpectedMigrations as untypedReadExpectedMigrations } from "../../scripts/migration-integrity.mjs";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const migrationTag = "0013_login_attempt_throttle";
const journalTable = "__drizzle_migrations";
const validBucketKey = "a".repeat(64);
const dropOrder = [
  "work_task_visit",
  "finance_ledger_entry",
  "finance_transaction",
  "finance_account",
  "login_attempt_throttle",
  "partnership_contribution_receipt",
  "partnership_contribution",
  "partnership_commission",
  "credit_card_installment",
  "expense",
  "credit_card",
  "work_task_project",
  "work_task",
  "user_permission",
  "user_account",
  "receivable_collection",
  "receivable",
  "monthly_visit_commitment",
  "consulting_contract",
  "customer_project",
  "project",
  "customer",
  "cron_dispatch_gate",
  "job_run",
  "scheduled_job",
  "outbox_event",
  "audit_event",
  "_platform_migration_verification",
  journalTable,
] as const;

interface ExpectedMigration {
  createdAt: number;
  hash: string;
  sqlFileName: string;
}

interface DatabaseIdentityRow extends RowDataPacket {
  database_name: string;
  server_version: string;
}

interface JournalRow extends RowDataPacket {
  created_at: number;
  hash: string;
  id: number;
}

const buildIncremental = untypedBuildIncremental as (options: {
  migrationTag: string;
  outputDirectory: string;
  projectRoot: string;
  serverVersionSha256: string;
  targetDatabaseSha256: string;
}) => Promise<{ manifestPath: string; sqlPath: string }>;
const readExpectedMigrations = untypedReadExpectedMigrations as (
  migrationsFolder: string,
) => Promise<ExpectedMigration[]>;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!enabled || typeof value !== "string" || value === "") {
    throw new Error("Disposable MariaDB test environment is incomplete.");
  }
  return value;
}

function migrationStatements(sql: string): string[] {
  return sql
    .split(/--> statement-breakpoint\s*/gu)
    .map((statement) => statement.trim().replace(/;\s*$/u, ""));
}

function bundleStatements(sql: string): string[] {
  const statements = sql
    .split(/\r?\n/u)
    .filter((line) => line !== "" && !line.startsWith("--"));
  if (statements.some((statement) => !statement.endsWith(";"))) {
    throw new Error("Incremental bundle is not line-delimited SQL.");
  }
  return statements.map((statement) => statement.slice(0, -1));
}

async function reset(pool: Pool) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET SESSION foreign_key_checks = 0");
    for (const tableName of dropOrder) {
      await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    }
    await connection.query("SET SESSION foreign_key_checks = 1");
  } finally {
    connection.release();
  }
}

describe.skipIf(!enabled).sequential(
  "0012 to 0013 target-bound phpMyAdmin login-throttle migration on real MariaDB",
  () => {
    let pool: Pool;
    let outputDirectory = "";

    beforeAll(async () => {
      pool = mysql.createPool({
        charset: "utf8mb4",
        connectionLimit: 2,
        database: requiredEnvironment("DB_NAME"),
        dateStrings: true,
        decimalNumbers: false,
        host: requiredEnvironment("DB_HOST"),
        multipleStatements: false,
        password: requiredEnvironment("DB_PASSWORD"),
        port: Number(requiredEnvironment("DB_PORT")),
        timezone: "Z",
        user: requiredEnvironment("DB_USER"),
      });
      await reset(pool);
      outputDirectory = await mkdtemp(
        path.resolve(tmpdir(), "portal-pusula-login-throttle-it-"),
      );
    });

    afterAll(async () => {
      try {
        if (pool) await reset(pool);
      } finally {
        try {
          if (pool) await pool.end();
        } finally {
          if (outputDirectory) {
            await rm(outputDirectory, { force: true, recursive: true });
          }
        }
      }
    });

    it("installs the bounded throttle ledger and records journal row 14", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const prefix = migrations.slice(0, 13);
      const target = migrations[13];
      expect(target?.sqlFileName).toBe(`${migrationTag}.sql`);

      await pool.query(
        `CREATE TABLE \`${journalTable}\` (
          \`id\` SERIAL PRIMARY KEY,
          \`hash\` TEXT NOT NULL,
          \`created_at\` BIGINT
        )`,
      );
      for (const migration of prefix) {
        const sql = await readFile(
          path.join(repositoryRoot, "drizzle", migration.sqlFileName),
          "utf8",
        );
        for (const statement of migrationStatements(sql)) {
          await pool.query(statement);
        }
        await pool.execute(
          `INSERT INTO \`${journalTable}\` (hash, created_at) VALUES (?, ?)`,
          [migration.hash, migration.createdAt],
        );
      }

      const [identityRows] = await pool.query<DatabaseIdentityRow[]>(
        "SELECT DATABASE() AS database_name, VERSION() AS server_version",
      );
      const identity = identityRows[0];
      if (!identity) throw new Error("Disposable MariaDB identity is missing.");
      const summary = await buildIncremental({
        migrationTag,
        outputDirectory,
        projectRoot: repositoryRoot,
        serverVersionSha256: createHash("sha256")
          .update(identity.server_version, "utf8")
          .digest("hex"),
        targetDatabaseSha256: createHash("sha256")
          .update(identity.database_name, "utf8")
          .digest("hex"),
      });
      const incrementalSql = await readFile(
        path.resolve(repositoryRoot, summary.sqlPath),
        "utf8",
      );
      const results: string[] = [];
      for (const statement of bundleStatements(incrementalSql)) {
        const [rows] = await pool.query<RowDataPacket[]>(statement);
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (typeof row.portal_pusula_incremental_result === "string") {
              results.push(row.portal_pusula_incremental_result);
            }
          }
        }
      }
      expect(results).toEqual(["PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK"]);

      const [journal] = await pool.query<JournalRow[]>(
        `SELECT id, hash, created_at FROM \`${journalTable}\` ORDER BY id`,
      );
      expect(journal).toHaveLength(14);
      expect(journal.at(-1)).toEqual({
        created_at: target?.createdAt,
        hash: target?.hash,
        id: 14,
      });

      const [tableRows] = await pool.query<RowDataPacket[]>(
        `SELECT ENGINE, TABLE_COLLATION
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'login_attempt_throttle'`,
      );
      expect(tableRows).toEqual([
        { ENGINE: "InnoDB", TABLE_COLLATION: "utf8mb4_unicode_ci" },
      ]);

      const [columnRows] = await pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE,
                CHARACTER_SET_NAME, COLLATION_NAME
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'login_attempt_throttle'
          ORDER BY ORDINAL_POSITION`,
      );
      expect(columnRows).toEqual([
        {
          CHARACTER_SET_NAME: "ascii",
          COLLATION_NAME: "ascii_bin",
          COLUMN_NAME: "bucket_key",
          COLUMN_TYPE: "char(64)",
          DATA_TYPE: "char",
          IS_NULLABLE: "NO",
        },
        {
          CHARACTER_SET_NAME: "ascii",
          COLLATION_NAME: "ascii_bin",
          COLUMN_NAME: "bucket_type",
          COLUMN_TYPE: "varchar(16)",
          DATA_TYPE: "varchar",
          IS_NULLABLE: "NO",
        },
        expect.objectContaining({
          CHARACTER_SET_NAME: null,
          COLLATION_NAME: null,
          COLUMN_NAME: "failure_count",
          DATA_TYPE: "int",
          IS_NULLABLE: "NO",
        }),
        expect.objectContaining({
          COLUMN_NAME: "window_started_at_utc",
          COLUMN_TYPE: "datetime(6)",
          DATA_TYPE: "datetime",
          IS_NULLABLE: "NO",
        }),
        expect.objectContaining({
          COLUMN_NAME: "blocked_until_utc",
          COLUMN_TYPE: "datetime(6)",
          DATA_TYPE: "datetime",
          IS_NULLABLE: "YES",
        }),
        expect.objectContaining({
          COLUMN_NAME: "updated_at_utc",
          COLUMN_TYPE: "datetime(6)",
          DATA_TYPE: "datetime",
          IS_NULLABLE: "NO",
        }),
      ]);
      expect(columnRows[2]?.COLUMN_TYPE).toMatch(/^int(?:\(\d+\))? unsigned$/u);

      const [constraintRows] = await pool.query<RowDataPacket[]>(
        `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
           FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = 'login_attempt_throttle'
          ORDER BY CONSTRAINT_NAME`,
      );
      expect(constraintRows).toEqual([
        {
          CONSTRAINT_NAME: "chk_login_attempt_throttle_key",
          CONSTRAINT_TYPE: "CHECK",
        },
        {
          CONSTRAINT_NAME: "chk_login_attempt_throttle_state",
          CONSTRAINT_TYPE: "CHECK",
        },
        { CONSTRAINT_NAME: "PRIMARY", CONSTRAINT_TYPE: "PRIMARY KEY" },
      ]);

      const [indexRows] = await pool.query<RowDataPacket[]>(
        `SELECT INDEX_NAME, NON_UNIQUE,
                GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_order
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'login_attempt_throttle'
          GROUP BY INDEX_NAME, NON_UNIQUE
          ORDER BY INDEX_NAME`,
      );
      expect(indexRows).toEqual([
        {
          INDEX_NAME: "idx_login_attempt_throttle_blocked",
          NON_UNIQUE: 1,
          columns_in_order: "blocked_until_utc",
        },
        {
          INDEX_NAME: "idx_login_attempt_throttle_updated",
          NON_UNIQUE: 1,
          columns_in_order: "updated_at_utc",
        },
        {
          INDEX_NAME: "PRIMARY",
          NON_UNIQUE: 0,
          columns_in_order: "bucket_key",
        },
      ]);

      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'account', 1, '2026-09-04 12:00:00.000000', NULL,
                   '2026-09-04 12:00:00.000000')`,
          [validBucketKey],
        ),
      ).resolves.toBeDefined();
      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'account', 1, '2026-09-04 12:00:00.000000', NULL,
                   '2026-09-04 12:00:00.000000')`,
          ["A".repeat(64)],
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'invalid', 1, '2026-09-04 12:00:00.000000', NULL,
                   '2026-09-04 12:00:00.000000')`,
          ["b".repeat(64)],
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'network', 0, '2026-09-04 12:00:00.000000', NULL,
                   '2026-09-04 12:00:00.000000')`,
          ["c".repeat(64)],
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'global', 1001, '2026-09-04 12:00:00.000000', NULL,
                   '2026-09-04 12:00:00.000000')`,
          ["d".repeat(64)],
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'account', 2, '2026-09-04 12:01:00.000000', NULL,
                   '2026-09-04 12:00:00.000000')`,
          ["e".repeat(64)],
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.execute(
          `INSERT INTO login_attempt_throttle
            (bucket_key, bucket_type, failure_count, window_started_at_utc,
             blocked_until_utc, updated_at_utc)
           VALUES (?, 'account', 2, '2026-09-04 11:59:00.000000',
                   '2026-09-04 11:59:59.000000',
                   '2026-09-04 12:00:00.000000')`,
          ["f".repeat(64)],
        ),
      ).rejects.toBeDefined();
    }, 60_000);
  },
);
