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
const migrationTag = "0011_customer_projects_partnership";
const journalTable = "__drizzle_migrations";
const dropOrder = [
  "partnership_contribution_receipt",
  "partnership_contribution",
  "partnership_commission",
  "credit_card_installment",
  "expense",
  "credit_card",
  "work_task_project",
  "work_task",
  "receivable_collection",
  "receivable",
  "monthly_visit_commitment",
  "consulting_contract",
  "customer_project",
  "project",
  "user_account",
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
  "0010 to 0011 target-bound phpMyAdmin migration on real MariaDB",
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
        path.resolve(tmpdir(), "portal-pusula-incremental-it-"),
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

    it("backfills legacy project ownership, installs exact constraints, and supports the contribution receipt ledger", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const prefix = migrations.slice(0, 11);
      const target = migrations[11];
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

      const mkProjectId = "10000000-0000-4000-8000-000000000001";
      const secondProjectId = "10000000-0000-4000-8000-000000000002";
      const firstCustomerId = "20000000-0000-4000-8000-000000000001";
      const secondCustomerId = "20000000-0000-4000-8000-000000000002";
      const contractId = "30000000-0000-4000-8000-000000000001";
      const contractReceivableId = "40000000-0000-4000-8000-000000000001";
      const openingReceivableId = "40000000-0000-4000-8000-000000000002";
      const openingOperationKey = "50000000-0000-4000-8000-000000000001";
      const taskId = "60000000-0000-4000-8000-000000000001";

      await pool.execute(
        `INSERT INTO project
          (id, display_name, short_code, project_type, status)
         VALUES (?, 'Mühendis Kafası', 'MUHENDIS_KAFASI', 'consulting', 'active'),
                (?, 'İkinci proje', 'SECOND_PROJECT', 'product', 'active')`,
        [mkProjectId, secondProjectId],
      );
      await pool.execute(
        `INSERT INTO customer (id, display_name, short_code)
         VALUES (?, 'Birinci müşteri', 'FIRST_CUSTOMER'),
                (?, 'İkinci müşteri', 'SECOND_CUSTOMER')`,
        [firstCustomerId, secondCustomerId],
      );
      await pool.execute(
        `INSERT INTO consulting_contract
          (id, customer_id, status, starts_on, ends_on, monthly_fee_amount,
           currency, vat_mode, vat_rate, payment_day)
         VALUES (?, ?, 'active', '2026-02-01', '2026-12-31', 60000.0000,
                 'TRY', 'exempt', 0.00, 15)`,
        [contractId, firstCustomerId],
      );
      await pool.execute(
        `INSERT INTO receivable
          (id, customer_id, contract_id, source_type, period_month, due_on,
           description, net_amount, vat_amount, total_amount, currency)
         VALUES (?, ?, ?, 'contract_month', '2026-09-01', '2026-09-15',
                 'Eylül danışmanlık', 60000.0000, 0.0000, 60000.0000, 'TRY')`,
        [contractReceivableId, firstCustomerId, contractId],
      );
      await pool.execute(
        `INSERT INTO receivable
          (id, client_operation_key, customer_id, source_type, due_on,
           description, net_amount, vat_amount, total_amount, currency)
         VALUES (?, ?, ?, 'opening_balance', '2026-08-15',
                 'Geçmiş alacak', 12000.0000, 0.0000, 12000.0000, 'TRY')`,
        [openingReceivableId, openingOperationKey, secondCustomerId],
      );
      await pool.execute(
        `INSERT INTO work_task (id, customer_id, title, status, priority)
         VALUES (?, ?, 'Eski bağlı görev', 'todo', 'normal')`,
        [taskId, secondCustomerId],
      );
      await pool.execute(
        `INSERT INTO work_task_project (task_id, project_id)
         VALUES (?, ?)`,
        [taskId, secondProjectId],
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
      expect(journal).toHaveLength(12);
      expect(journal.at(-1)).toEqual({
        created_at: target?.createdAt,
        hash: target?.hash,
        id: 12,
      });

      const [linkRows] = await pool.query<RowDataPacket[]>(
        `SELECT customer_id, project_id, status
           FROM customer_project
          ORDER BY customer_id, project_id`,
      );
      expect(linkRows).toEqual([
        { customer_id: firstCustomerId, project_id: mkProjectId, status: "active" },
        { customer_id: secondCustomerId, project_id: mkProjectId, status: "active" },
        { customer_id: secondCustomerId, project_id: secondProjectId, status: "active" },
      ]);
      const [backfillRows] = await pool.query<RowDataPacket[]>(
        `SELECT
          (SELECT project_id FROM consulting_contract WHERE id = ?) AS contract_project_id,
          (SELECT project_id FROM receivable WHERE id = ?) AS contract_receivable_project_id,
          (SELECT project_id FROM receivable WHERE id = ?) AS opening_receivable_project_id`,
        [contractId, contractReceivableId, openingReceivableId],
      );
      expect(backfillRows[0]).toEqual({
        contract_project_id: mkProjectId,
        contract_receivable_project_id: mkProjectId,
        opening_receivable_project_id: mkProjectId,
      });

      const [columnRows] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN ('consulting_contract', 'receivable')
            AND COLUMN_NAME = 'project_id'
          ORDER BY TABLE_NAME`,
      );
      expect(columnRows).toEqual([
        {
          CHARACTER_SET_NAME: "ascii",
          COLLATION_NAME: "ascii_bin",
          COLUMN_TYPE: "char(36)",
          IS_NULLABLE: "YES",
          TABLE_NAME: "consulting_contract",
        },
        {
          CHARACTER_SET_NAME: "ascii",
          COLLATION_NAME: "ascii_bin",
          COLUMN_TYPE: "char(36)",
          IS_NULLABLE: "YES",
          TABLE_NAME: "receivable",
        },
      ]);

      const [indexRows] = await pool.query<RowDataPacket[]>(
        `SELECT INDEX_NAME, NON_UNIQUE,
                GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_order
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'consulting_contract'
            AND INDEX_NAME IN (
              'uq_consulting_contract_customer_start',
              'uq_consulting_contract_customer_project_start'
            )
          GROUP BY INDEX_NAME, NON_UNIQUE`,
      );
      expect(indexRows).toEqual([
        {
          INDEX_NAME: "uq_consulting_contract_customer_project_start",
          NON_UNIQUE: 0,
          columns_in_order: "customer_id,project_id,starts_on",
        },
      ]);

      await pool.execute(
        `INSERT INTO customer_project (customer_id, project_id)
         VALUES (?, ?)`,
        [firstCustomerId, secondProjectId],
      );
      await expect(
        pool.execute(
          `INSERT INTO consulting_contract
            (id, customer_id, project_id, status, starts_on, ends_on,
             monthly_fee_amount, currency, vat_mode, vat_rate, payment_day)
           VALUES ('30000000-0000-4000-8000-000000000002', ?, ?, 'active',
                   '2026-02-01', '2026-12-31', 1000.0000, 'TRY',
                   'exempt', 0.00, 15)`,
          [firstCustomerId, secondProjectId],
        ),
      ).resolves.toBeDefined();

      const commissionId = "70000000-0000-4000-8000-000000000001";
      const commissionOperation = "71000000-0000-4000-8000-000000000001";
      const contributionId = "80000000-0000-4000-8000-000000000001";
      const contributionOperation = "81000000-0000-4000-8000-000000000001";
      const receiptId = "90000000-0000-4000-8000-000000000001";
      const receiptOperation = "91000000-0000-4000-8000-000000000001";
      await pool.execute(
        `INSERT INTO partnership_commission
          (id, client_operation_key, project_id, transaction_type, description,
           closed_on, commission_basis_amount, contribution_mode, share_rate,
           share_amount)
         VALUES (?, ?, ?, 'rental', 'Kiralama komisyonu', '2026-09-01',
                 100000.0000, 'partner_only', 0.1000, 10000.0000)`,
        [commissionId, commissionOperation, secondProjectId],
      );
      await expect(
        pool.execute(
          `UPDATE partnership_commission
              SET share_rate = 0.2500, share_amount = 25000.0000
            WHERE id = ?`,
          [commissionId],
        ),
      ).rejects.toBeDefined();
      await pool.execute(
        `INSERT INTO partnership_contribution
          (id, client_operation_key, project_id, contribution_month,
           description, expected_amount, due_on)
         VALUES (?, ?, ?, '2026-09-01', 'Eylül ofis katkısı', 7000.0000,
                 '2026-09-15')`,
        [contributionId, contributionOperation, secondProjectId],
      );
      await pool.execute(
        `INSERT INTO partnership_contribution_receipt
          (id, client_operation_key, contribution_id, amount, received_on)
         VALUES (?, ?, ?, 3000.0000, '2026-09-10')`,
        [receiptId, receiptOperation, contributionId],
      );
      await pool.execute(
        `UPDATE partnership_contribution
            SET received_amount = 3000.0000,
                received_on = '2026-09-10',
                status = 'partial'
          WHERE id = ?`,
        [contributionId],
      );
      const [ledgerRows] = await pool.query<RowDataPacket[]>(
        `SELECT CAST(pc.received_amount AS CHAR) AS received_amount,
                CAST(SUM(pcr.amount) AS CHAR) AS receipt_total,
                pc.status
           FROM partnership_contribution pc
           JOIN partnership_contribution_receipt pcr
             ON pcr.contribution_id = pc.id
          WHERE pc.id = ?
          GROUP BY pc.id, pc.received_amount, pc.status`,
        [contributionId],
      );
      expect(ledgerRows).toEqual([
        {
          receipt_total: "3000.0000",
          received_amount: "3000.0000",
          status: "partial",
        },
      ]);
      await expect(
        pool.execute(
          `INSERT INTO partnership_contribution_receipt
            (id, client_operation_key, contribution_id, amount, received_on)
           VALUES ('90000000-0000-4000-8000-000000000002',
                   '91000000-0000-4000-8000-000000000002',
                   '80000000-0000-4000-8000-000000000099',
                   1.0000, '2026-09-10')`,
        ),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    }, 60_000);
  },
);
