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
const migrationTag = "0012_user_permissions";
const journalTable = "__drizzle_migrations";
const ownerId = "10000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000002";
const validPasswordHash =
  "scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const dropOrder = [
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
  "0011 to 0012 target-bound phpMyAdmin user-permission migration on real MariaDB",
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
        path.resolve(tmpdir(), "portal-pusula-user-permissions-it-"),
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

    it("preserves the owner, installs the allowlisted permission ledger, and records journal row 13", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const prefix = migrations.slice(0, 12);
      const target = migrations[12];
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

      await pool.execute(
        `INSERT INTO user_account
          (id, email, password_hash, password_changed_at_utc,
           created_at_utc, updated_at_utc)
         VALUES (?, 'owner@example.test', ?, '2026-09-03 12:00:00.000000',
                 '2026-09-03 12:00:00.000000', '2026-09-03 12:00:00.000000')`,
        [ownerId, validPasswordHash],
      );

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
      const connection = await pool.getConnection();
      try {
        for (const [statementIndex, statement] of bundleStatements(
          incrementalSql,
        ).entries()) {
          let rows: RowDataPacket[];
          try {
            [rows] = await connection.query<RowDataPacket[]>(statement);
          } catch (error) {
            const code =
              error && typeof error === "object" && "code" in error
                ? String(error.code)
                : "UNKNOWN";
            const [diagnostics] = await connection.query<RowDataPacket[]>(
              `SELECT @pp_step AS step,
                      (SELECT COUNT(*) FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE()
                          AND TABLE_NAME = 'user_account'
                          AND COLUMN_NAME = 'display_name') AS display_name_columns,
                      (SELECT COUNT(*) FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE()
                          AND TABLE_NAME = 'user_account'
                          AND COLUMN_NAME = 'role') AS role_columns,
                      (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                        WHERE CONSTRAINT_SCHEMA = DATABASE()
                          AND TABLE_NAME = 'user_account'
                          AND CONSTRAINT_NAME = 'chk_user_account_state') AS state_checks`,
            );
            const diagnostic = diagnostics[0];
            throw new Error(
              `Incremental statement ${statementIndex} failed: ${code}; step=${String(diagnostic?.step)}; display=${String(diagnostic?.display_name_columns)}; role=${String(diagnostic?.role_columns)}; state-check=${String(diagnostic?.state_checks)}`,
            );
          }
          if (Array.isArray(rows)) {
            for (const row of rows) {
              if (typeof row.portal_pusula_incremental_result === "string") {
                results.push(row.portal_pusula_incremental_result);
              }
            }
          }
        }
      } finally {
        connection.release();
      }
      expect(results).toEqual(["PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK"]);

      const [journal] = await pool.query<JournalRow[]>(
        `SELECT id, hash, created_at FROM \`${journalTable}\` ORDER BY id`,
      );
      expect(journal).toHaveLength(13);
      expect(journal.at(-1)).toEqual({
        created_at: target?.createdAt,
        hash: target?.hash,
        id: 13,
      });

      const [ownerRows] = await pool.query<RowDataPacket[]>(
        "SELECT display_name, role, status FROM user_account WHERE id = ?",
        [ownerId],
      );
      expect(ownerRows).toEqual([
        {
          display_name: "Portal Yöneticisi",
          role: "owner",
          status: "active",
        },
      ]);

      const [columnRows] = await pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
                CHARACTER_SET_NAME, COLLATION_NAME,
                REPLACE(COLUMN_DEFAULT, '''', '') AS normalized_default
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'user_account'
            AND COLUMN_NAME IN ('display_name', 'role')
          ORDER BY COLUMN_NAME`,
      );
      expect(columnRows).toEqual([
        expect.objectContaining({
          COLUMN_NAME: "display_name",
          COLUMN_TYPE: "varchar(191)",
          IS_NULLABLE: "NO",
          normalized_default: null,
        }),
        expect.objectContaining({
          CHARACTER_SET_NAME: "ascii",
          COLLATION_NAME: "ascii_bin",
          COLUMN_NAME: "role",
          COLUMN_TYPE: "varchar(16)",
          IS_NULLABLE: "NO",
          normalized_default: "member",
        }),
      ]);

      await pool.execute(
        `INSERT INTO user_account
          (id, email, display_name, password_hash, password_changed_at_utc,
           created_at_utc, updated_at_utc)
         VALUES (?, 'member@example.test', 'Ekip Üyesi', ?,
                 '2026-09-03 12:00:00.000000',
                 '2026-09-03 12:00:00.000000', '2026-09-03 12:00:00.000000')`,
        [memberId, validPasswordHash],
      );
      await pool.execute(
        `INSERT INTO user_permission (user_account_id, permission_code)
         VALUES (?, 'customers.read'), (?, 'tasks.read')`,
        [memberId, memberId],
      );
      await expect(
        pool.execute(
          `INSERT INTO user_permission (user_account_id, permission_code)
           VALUES (?, 'finance.secrets.read')`,
          [memberId],
        ),
      ).rejects.toBeDefined();
      await expect(
        pool.execute("DELETE FROM user_account WHERE id = ?", [memberId]),
      ).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
      await expect(
        pool.execute("UPDATE user_account SET role = 'admin' WHERE id = ?", [
          memberId,
        ]),
      ).rejects.toBeDefined();

      const [permissionRows] = await pool.query<RowDataPacket[]>(
        `SELECT permission_code
           FROM user_permission
          WHERE user_account_id = ?
          ORDER BY permission_code`,
        [memberId],
      );
      expect(permissionRows).toEqual([
        { permission_code: "customers.read" },
        { permission_code: "tasks.read" },
      ]);
    }, 60_000);
  },
);
