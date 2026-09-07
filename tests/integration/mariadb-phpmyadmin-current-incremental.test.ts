import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import mysql, {
  type Pool,
  type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error Deployment artifact builders are intentionally plain Node ESM.
import { buildPhpMyAdminIncrementalMigrationBundle as untypedBuildIncremental } from "../../scripts/build-phpmyadmin-incremental-migration.mjs";
// @ts-expect-error The migration integrity contract is intentionally plain Node ESM.
import { readExpectedMigrations as untypedReadExpectedMigrations } from "../../scripts/migration-integrity.mjs";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const journalTable = "__drizzle_migrations";
const lifecycleTag = "0014_record_lifecycle";
const reversalTag = "0015_financial_reversals";
const financeAccountsTag = "0016_finance_accounts_ledger";
const workTaskVisitTag = "0017_work_task_visit";
const planningExpenseCategoriesTag =
  "0018_planning_expense_categories";
const successResult = "PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK";
const financePermissionMemberId = "10000000-0000-4000-8000-000000000016";
const validPasswordHash =
  "scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
  "expense_category",
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

const lifecycleChecks = [
  "chk_consulting_contract_archive",
  "chk_consulting_contract_timeline",
  "chk_consulting_contract_version",
  "chk_customer_archive",
  "chk_customer_timeline",
  "chk_customer_version",
  "chk_project_archive",
  "chk_project_timeline",
  "chk_user_permission_code",
  "chk_work_task_archive",
  "chk_work_task_status",
  "chk_work_task_timeline",
] as const;

const reversalChecks = [
  "chk_partnership_contribution_receipt_entry",
  "chk_partnership_contribution_receipt_identity",
  "chk_receivable_collection_entry",
  "chk_receivable_collection_identity",
  "chk_receivable_record_state",
  "chk_receivable_timeline",
  "chk_receivable_version",
  "chk_receivable_void_shape",
] as const;

const lifecycleIndexes = [
  "idx_consulting_contract_customer_status",
  "idx_customer_status_name",
  "idx_project_status_name",
  "idx_work_task_board",
] as const;

const reversalIndexes = [
  "idx_receivable_state_due",
  "uq_partnership_contribution_receipt_reversal",
  "uq_receivable_collection_reversal",
] as const;

const financeAccountConstraints = [
  "chk_finance_account_identity",
  "chk_finance_ledger_entry_amount",
  "chk_finance_transaction_shape",
  "fk_finance_ledger_entry_account",
  "fk_finance_ledger_entry_transaction",
  "fk_finance_transaction_reversal",
  "fk_finance_transaction_source_account",
  "fk_finance_transaction_target_account",
] as const;

const workTaskVisitConstraints = [
  "chk_work_task_visit_identity",
  "fk_work_task_visit_task",
  "fk_work_task_visit_visit",
] as const;

const planningExpenseCategoryChecks = [
  "chk_expense_category_code",
  "chk_expense_category_display_name",
  "chk_expense_category_flags",
  "chk_expense_category_identity",
  "chk_expense_category_timeline",
  "chk_expense_category_version",
] as const;

const planningExpenseCategoryIndexes = [
  "PRIMARY",
  "idx_expense_category_status_name",
  "uq_expense_category_client_operation",
  "uq_expense_category_code",
  "uq_expense_category_display_name",
] as const;

const planningFixture = Object.freeze({
  contractId: "c2000000-0000-4000-8000-000000000002",
  customerId: "c1000000-0000-4000-8000-000000000001",
  expenseId: "c4000000-0000-4000-8000-000000000004",
  expenseOperationKey: "c5000000-0000-4000-8000-000000000005",
  visitId: "c3000000-0000-4000-8000-000000000003",
});

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
  created_at: number | string;
  hash: string;
  id: number | string;
}

interface IncrementalResult {
  migrationTag: string;
  result: string;
}

const buildIncremental = untypedBuildIncremental as (options: {
  migrationTag: string;
  outputDirectory: string;
  projectRoot: string;
  serverVersionSha256: string;
  targetDatabaseSha256: string;
}) => Promise<{ sqlPath: string }>;

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
    .map((statement) => statement.trim().replace(/;\s*$/u, ""))
    .filter(Boolean);
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

async function reset(pool: Pool): Promise<void> {
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

async function seedJournalPrefix(
  pool: Pool,
  migrations: readonly ExpectedMigration[],
  count: number,
): Promise<void> {
  await reset(pool);
  await pool.query(
    `CREATE TABLE \`${journalTable}\` (
      \`id\` SERIAL PRIMARY KEY,
      \`hash\` TEXT NOT NULL,
      \`created_at\` BIGINT
    )`,
  );
  for (const migration of migrations.slice(0, count)) {
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
}

async function journalRows(pool: Pool): Promise<readonly JournalRow[]> {
  const [rows] = await pool.query<JournalRow[]>(
    `SELECT id, hash, created_at FROM \`${journalTable}\` ORDER BY id`,
  );
  return rows.map((row) => ({
    created_at: Number(row.created_at),
    hash: row.hash,
    id: Number(row.id),
  })) as JournalRow[];
}

async function executeIncremental(
  pool: Pool,
  sql: string,
  diagnose = false,
): Promise<Readonly<{ errors: number; results: readonly IncrementalResult[] }>> {
  const connection = await pool.getConnection();
  let destroyed = false;
  const results: IncrementalResult[] = [];
  try {
    for (const [statementIndex, statement] of bundleStatements(sql).entries()) {
      try {
        const [rows] = await connection.query<RowDataPacket[]>(statement);
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          if (
            typeof row.portal_pusula_incremental_result === "string" &&
            typeof row.migration_tag === "string"
          ) {
            results.push({
              migrationTag: row.migration_tag,
              result: row.portal_pusula_incremental_result,
            });
          }
        }
      } catch (error) {
        if (diagnose) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "UNKNOWN";
          const [diagnostics] = await connection.query<RowDataPacket[]>(
            "SELECT @pp_step AS step, @pp_selected_tag AS selected_tag",
          );
          console.error(
            `Current incremental statement ${statementIndex} failed: ${code}; step=${String(diagnostics[0]?.step)}; tag=${String(diagnostics[0]?.selected_tag)}`,
          );
        }
        connection.destroy();
        destroyed = true;
        return { errors: 1, results };
      }
    }
    return { errors: 0, results };
  } finally {
    if (!destroyed) connection.release();
  }
}

function sqlList(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

async function namedConstraints(
  pool: Pool,
  names: readonly string[],
): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
            CONSTRAINT_TYPE AS constraint_type
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_NAME IN (${sqlList(names)})
      ORDER BY BINARY CONSTRAINT_NAME`,
    [...names],
  );
  return rows;
}

async function namedIndexes(
  pool: Pool,
  names: readonly string[],
): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_order
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND INDEX_NAME IN (${sqlList(names)})
      GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
      ORDER BY BINARY INDEX_NAME`,
    [...names],
  );
  return rows;
}

async function tableIndexes(
  pool: Pool,
  tableName: string,
): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_order
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY BINARY INDEX_NAME`,
    [tableName],
  );
  return rows;
}

async function namedCheckClauses(
  pool: Pool,
  names: readonly string[],
): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT tc.TABLE_NAME AS table_name,
            cc.CONSTRAINT_NAME AS constraint_name,
            cc.CHECK_CLAUSE AS check_clause
       FROM information_schema.TABLE_CONSTRAINTS AS tc
       INNER JOIN information_schema.CHECK_CONSTRAINTS AS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.TABLE_SCHEMA = DATABASE()
        AND tc.CONSTRAINT_NAME IN (${sqlList(names)})
      ORDER BY BINARY tc.TABLE_NAME, BINARY cc.CONSTRAINT_NAME`,
    [...names],
  );
  return rows;
}

async function planningForeignKey(pool: Pool): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kcu.TABLE_NAME AS table_name,
            kcu.CONSTRAINT_NAME AS constraint_name,
            kcu.COLUMN_NAME AS column_name,
            kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
            kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
            rc.DELETE_RULE AS delete_rule,
            rc.UPDATE_RULE AS update_rule
       FROM information_schema.KEY_COLUMN_USAGE AS kcu
       INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.TABLE_NAME = kcu.TABLE_NAME
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE kcu.TABLE_SCHEMA = DATABASE()
        AND kcu.TABLE_NAME = 'expense'
        AND kcu.CONSTRAINT_NAME = 'fk_expense_category'`,
  );
  return rows;
}

async function planningColumnMetadata(
  pool: Pool,
): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
            CHARACTER_SET_NAME AS character_set_name,
            COLLATION_NAME AS collation_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          TABLE_NAME = 'expense_category'
          OR (TABLE_NAME = 'monthly_visit_commitment'
              AND COLUMN_NAME = 'location_label')
        )
      ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION`,
  );
  return rows;
}

async function expenseCategorySeedRows(
  pool: Pool,
): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT code, display_name, is_system, status, version
       FROM expense_category
      ORDER BY BINARY code`,
  );
  return rows;
}

async function showCreateTable(pool: Pool, tableName: string): Promise<string> {
  if (!/^[a-z0-9_]+$/u.test(tableName)) {
    throw new Error("Unsafe integration-test table name.");
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SHOW CREATE TABLE \`${tableName}\``,
  );
  const createSql = rows[0]?.["Create Table"];
  if (typeof createSql !== "string") {
    throw new Error("Disposable MariaDB table definition is missing.");
  }
  return createSql;
}

async function planningMigrationState(pool: Pool): Promise<unknown> {
  const [categoryRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'expense_category'`,
  );
  const categoryTableCount = Number(categoryRows[0]?.table_count);
  return {
    categoryCreate:
      categoryTableCount === 1
        ? await showCreateTable(pool, "expense_category")
        : null,
    categoryTableCount,
    expenseCreate: await showCreateTable(pool, "expense"),
    journal: await journalRows(pool),
    visitCreate: await showCreateTable(pool, "monthly_visit_commitment"),
  };
}

async function seedPlanningBusinessRows(pool: Pool): Promise<void> {
  await pool.execute(
    `INSERT INTO customer (id, display_name, short_code)
     VALUES (?, '0018 artımlı geçiş müşterisi', 'INCREMENTAL_0018')`,
    [planningFixture.customerId],
  );
  await pool.execute(
    `INSERT INTO consulting_contract
       (id, customer_id, status, starts_on, ends_on, monthly_fee_amount,
        currency, vat_mode, vat_rate, payment_day, internal_note)
     VALUES (?, ?, 'active', '2026-01-01', '2026-12-31', 12000.0000,
             'TRY', 'exclusive', 20.00, 5, 'Geçişte korunacak sözleşme')`,
    [planningFixture.contractId, planningFixture.customerId],
  );
  await pool.execute(
    `INSERT INTO monthly_visit_commitment
       (id, contract_id, committed_on, resolution_status, resolution_note)
     VALUES (?, ?, '2026-09-15', 'planned', 'Geçişte korunacak ziyaret')`,
    [planningFixture.visitId, planningFixture.contractId],
  );
  await pool.execute(
    `INSERT INTO expense
       (id, client_operation_key, incurred_on, category, description,
        payment_method, net_amount, vat_amount, total_amount, currency,
        installment_count, note)
     VALUES (?, ?, '2026-09-08', 'rent', 'Geçişte korunacak gider',
             'cash', 100.0000, 20.0000, 120.0000, 'TRY', 1,
             'Satır içeriği değişmemeli')`,
    [planningFixture.expenseId, planningFixture.expenseOperationKey],
  );
}

async function planningBusinessRows(pool: Pool): Promise<unknown> {
  const [expenseRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, client_operation_key, incurred_on, category, description,
            payment_method, net_amount, vat_amount, total_amount, currency,
            installment_count, note, status, version
       FROM expense
      WHERE id = ?`,
    [planningFixture.expenseId],
  );
  const [visitRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, contract_id, committed_on, resolution_status,
            internal_planned_at_utc, internal_duration_minutes, delivered_on,
            resolution_note, created_at_utc, updated_at_utc
       FROM monthly_visit_commitment
      WHERE id = ?`,
    [planningFixture.visitId],
  );
  return { expenseRows, visitRows };
}

async function targetColumns(pool: Pool): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
            CHARACTER_SET_NAME AS character_set_name,
            COLLATION_NAME AS collation_name,
            REPLACE(COLUMN_DEFAULT, '''', '') AS normalized_default
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          COLUMN_NAME IN ('archive_reason', 'archived_at_utc',
                          'archived_by_user_account_id')
          OR (COLUMN_NAME = 'version'
              AND TABLE_NAME IN ('consulting_contract', 'customer'))
          OR (TABLE_NAME = 'receivable'
              AND COLUMN_NAME IN ('record_state', 'void_reason',
                                  'voided_at_utc', 'version'))
          OR (TABLE_NAME IN ('receivable_collection',
                             'partnership_contribution_receipt')
              AND COLUMN_NAME IN ('entry_type', 'reversal_of_id',
                                  'reversal_reason'))
        )
      ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION`,
  );
  return rows;
}

async function reversalForeignKeys(pool: Pool): Promise<readonly RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CONSTRAINT_NAME AS constraint_name,
            TABLE_NAME AS table_name,
            REFERENCED_TABLE_NAME AS referenced_table_name,
            UPDATE_RULE AS update_rule, DELETE_RULE AS delete_rule
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_NAME IN (
          'fk_partnership_contribution_receipt_reversal',
          'fk_receivable_collection_reversal'
        )
      ORDER BY BINARY CONSTRAINT_NAME`,
  );
  return rows;
}

async function contractSnapshot(pool: Pool): Promise<unknown> {
  return {
    columns: await targetColumns(pool),
    constraints: await namedConstraints(pool, [
      ...lifecycleChecks,
      ...reversalChecks,
    ]),
    foreignKeys: await reversalForeignKeys(pool),
    indexes: await namedIndexes(pool, [
      ...lifecycleIndexes,
      ...reversalIndexes,
    ]),
    journal: await journalRows(pool),
  };
}

function rowByKey(
  rows: readonly RowDataPacket[],
  tableName: string,
  columnName: string,
): RowDataPacket | undefined {
  return rows.find(
    (row) => row.table_name === tableName && row.column_name === columnName,
  );
}

describe.skipIf(!enabled).sequential(
  "0013 through 0018 target-bound phpMyAdmin incrementals on real MariaDB",
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
        path.resolve(tmpdir(), "portal-pusula-current-incremental-it-"),
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

    it("advances journal 14 to 18, installs exact contracts, and rejects replay or a wrong prefix", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const lifecycle = migrations[14];
      const reversal = migrations[15];
      const financeAccounts = migrations[16];
      const workTaskVisit = migrations[17];
      expect(lifecycle?.sqlFileName).toBe(`${lifecycleTag}.sql`);
      expect(reversal?.sqlFileName).toBe(`${reversalTag}.sql`);
      expect(financeAccounts?.sqlFileName).toBe(`${financeAccountsTag}.sql`);
      expect(workTaskVisit?.sqlFileName).toBe(`${workTaskVisitTag}.sql`);

      const [identityRows] = await pool.query<DatabaseIdentityRow[]>(
        "SELECT DATABASE() AS database_name, VERSION() AS server_version",
      );
      const identity = identityRows[0];
      if (!identity) throw new Error("Disposable MariaDB identity is missing.");
      const buildOptions = {
        outputDirectory,
        projectRoot: repositoryRoot,
        serverVersionSha256: createHash("sha256")
          .update(identity.server_version, "utf8")
          .digest("hex"),
        targetDatabaseSha256: createHash("sha256")
          .update(identity.database_name, "utf8")
          .digest("hex"),
      };
      const lifecycleSummary = await buildIncremental({
        ...buildOptions,
        migrationTag: lifecycleTag,
      });
      const reversalSummary = await buildIncremental({
        ...buildOptions,
        migrationTag: reversalTag,
      });
      const financeAccountsSummary = await buildIncremental({
        ...buildOptions,
        migrationTag: financeAccountsTag,
      });
      const workTaskVisitSummary = await buildIncremental({
        ...buildOptions,
        migrationTag: workTaskVisitTag,
      });
      const lifecycleSql = await readFile(
        path.resolve(repositoryRoot, lifecycleSummary.sqlPath),
        "utf8",
      );
      const reversalSql = await readFile(
        path.resolve(repositoryRoot, reversalSummary.sqlPath),
        "utf8",
      );
      const financeAccountsSql = await readFile(
        path.resolve(repositoryRoot, financeAccountsSummary.sqlPath),
        "utf8",
      );
      const workTaskVisitSql = await readFile(
        path.resolve(repositoryRoot, workTaskVisitSummary.sqlPath),
        "utf8",
      );

      await seedJournalPrefix(pool, migrations, 14);
      expect(await journalRows(pool)).toHaveLength(14);

      await expect(executeIncremental(pool, lifecycleSql, true)).resolves.toEqual({
        errors: 0,
        results: [{ migrationTag: lifecycleTag, result: successResult }],
      });
      const journal15 = await journalRows(pool);
      expect(journal15).toHaveLength(15);
      expect(journal15.at(-1)).toEqual({
        created_at: lifecycle?.createdAt,
        hash: lifecycle?.hash,
        id: 15,
      });
      expect(await namedConstraints(pool, lifecycleChecks)).toHaveLength(
        lifecycleChecks.length,
      );
      expect(await namedIndexes(pool, lifecycleIndexes)).toEqual([
        {
          columns_in_order: "customer_id,archived_at_utc,status,ends_on",
          index_name: "idx_consulting_contract_customer_status",
          non_unique: 1,
          table_name: "consulting_contract",
        },
        {
          columns_in_order: "archived_at_utc,status,display_name",
          index_name: "idx_customer_status_name",
          non_unique: 1,
          table_name: "customer",
        },
        {
          columns_in_order: "archived_at_utc,status,display_name",
          index_name: "idx_project_status_name",
          non_unique: 1,
          table_name: "project",
        },
        {
          columns_in_order: "archived_at_utc,status,due_on,updated_at_utc",
          index_name: "idx_work_task_board",
          non_unique: 1,
          table_name: "work_task",
        },
      ]);

      await expect(executeIncremental(pool, reversalSql, true)).resolves.toEqual({
        errors: 0,
        results: [{ migrationTag: reversalTag, result: successResult }],
      });
      const journal16 = await journalRows(pool);
      expect(journal16).toHaveLength(16);
      expect(journal16.at(-1)).toEqual({
        created_at: reversal?.createdAt,
        hash: reversal?.hash,
        id: 16,
      });

      const columns = await targetColumns(pool);
      expect(columns).toHaveLength(24);
      expect(
        rowByKey(columns, "consulting_contract", "archived_by_user_account_id"),
      ).toEqual(expect.objectContaining({
        character_set_name: "ascii",
        collation_name: "ascii_bin",
        column_type: "char(36)",
        is_nullable: "YES",
      }));
      expect(rowByKey(columns, "customer", "version")).toEqual(
        expect.objectContaining({
          is_nullable: "NO",
          normalized_default: "1",
        }),
      );
      expect(rowByKey(columns, "receivable", "record_state")).toEqual(
        expect.objectContaining({
          column_type: "varchar(16)",
          is_nullable: "NO",
          normalized_default: "active",
        }),
      );
      expect(rowByKey(columns, "receivable", "version")?.column_type).toMatch(
        /^int(?:\(\d+\))? unsigned$/u,
      );
      expect(
        rowByKey(columns, "receivable_collection", "entry_type"),
      ).toEqual(expect.objectContaining({
        is_nullable: "NO",
        normalized_default: "collection",
      }));
      expect(
        rowByKey(
          columns,
          "partnership_contribution_receipt",
          "entry_type",
        ),
      ).toEqual(expect.objectContaining({
        is_nullable: "NO",
        normalized_default: "receipt",
      }));
      expect(
        rowByKey(columns, "receivable_collection", "reversal_of_id"),
      ).toEqual(expect.objectContaining({
        character_set_name: "ascii",
        collation_name: "ascii_bin",
        column_type: "char(36)",
        is_nullable: "YES",
      }));

      expect(await namedConstraints(pool, reversalChecks)).toHaveLength(
        reversalChecks.length,
      );
      expect(await reversalForeignKeys(pool)).toEqual([
        {
          constraint_name: "fk_partnership_contribution_receipt_reversal",
          delete_rule: "RESTRICT",
          referenced_table_name: "partnership_contribution_receipt",
          table_name: "partnership_contribution_receipt",
          update_rule: "RESTRICT",
        },
        {
          constraint_name: "fk_receivable_collection_reversal",
          delete_rule: "RESTRICT",
          referenced_table_name: "receivable_collection",
          table_name: "receivable_collection",
          update_rule: "RESTRICT",
        },
      ]);
      expect(await namedIndexes(pool, reversalIndexes)).toEqual([
        {
          columns_in_order: "record_state,due_on,customer_id",
          index_name: "idx_receivable_state_due",
          non_unique: 1,
          table_name: "receivable",
        },
        {
          columns_in_order: "reversal_of_id",
          index_name: "uq_partnership_contribution_receipt_reversal",
          non_unique: 0,
          table_name: "partnership_contribution_receipt",
        },
        {
          columns_in_order: "reversal_of_id",
          index_name: "uq_receivable_collection_reversal",
          non_unique: 0,
          table_name: "receivable_collection",
        },
      ]);

      await pool.execute(
        `INSERT INTO user_account
          (id, email, display_name, password_hash, password_changed_at_utc,
           created_at_utc, updated_at_utc)
         VALUES (?, 'finance-member@example.test', 'Finans Üyesi', ?,
                 '2026-09-07 09:00:00.000000',
                 '2026-09-07 09:00:00.000000',
                 '2026-09-07 09:00:00.000000')`,
        [financePermissionMemberId, validPasswordHash],
      );
      await pool.execute(
        `INSERT INTO user_permission (user_account_id, permission_code)
         VALUES (?, 'tasks.read')`,
        [financePermissionMemberId],
      );

      await expect(
        executeIncremental(pool, financeAccountsSql, true),
      ).resolves.toEqual({
        errors: 0,
        results: [{ migrationTag: financeAccountsTag, result: successResult }],
      });
      const journal17 = await journalRows(pool);
      expect(journal17).toHaveLength(17);
      expect(journal17.at(-1)).toEqual({
        created_at: financeAccounts?.createdAt,
        hash: financeAccounts?.hash,
        id: 17,
      });
      expect(
        await namedConstraints(pool, financeAccountConstraints),
      ).toHaveLength(financeAccountConstraints.length);
      await pool.execute(
        `INSERT INTO user_permission (user_account_id, permission_code)
         VALUES (?, 'finance.accounts.read'),
                (?, 'finance.accounts.write')`,
        [financePermissionMemberId, financePermissionMemberId],
      );
      const [permissionRows] = await pool.query<RowDataPacket[]>(
        `SELECT permission_code
           FROM user_permission
          WHERE user_account_id = ?
          ORDER BY BINARY permission_code`,
        [financePermissionMemberId],
      );
      expect(permissionRows.map((row) => row.permission_code)).toEqual([
        "finance.accounts.read",
        "finance.accounts.write",
        "tasks.read",
      ]);

      await expect(
        executeIncremental(pool, workTaskVisitSql, true),
      ).resolves.toEqual({
        errors: 0,
        results: [{ migrationTag: workTaskVisitTag, result: successResult }],
      });
      const journal18 = await journalRows(pool);
      expect(journal18).toHaveLength(18);
      expect(journal18.at(-1)).toEqual({
        created_at: workTaskVisit?.createdAt,
        hash: workTaskVisit?.hash,
        id: 18,
      });
      expect(
        await namedConstraints(pool, workTaskVisitConstraints),
      ).toHaveLength(workTaskVisitConstraints.length);

      const completedSnapshot = {
        contract: await contractSnapshot(pool),
        finance: await namedConstraints(pool, financeAccountConstraints),
        taskVisit: await namedConstraints(pool, workTaskVisitConstraints),
      };
      await expect(executeIncremental(pool, workTaskVisitSql)).resolves.toEqual({
        errors: 1,
        results: [],
      });
      expect({
        contract: await contractSnapshot(pool),
        finance: await namedConstraints(pool, financeAccountConstraints),
        taskVisit: await namedConstraints(pool, workTaskVisitConstraints),
      }).toEqual(completedSnapshot);

      await seedJournalPrefix(pool, migrations, 14);
      await pool.execute(
        `UPDATE \`${journalTable}\` SET hash = ? WHERE id = 14`,
        ["0".repeat(64)],
      );
      const wrongPrefixJournal = await journalRows(pool);
      expect(await targetColumns(pool)).toHaveLength(0);
      const wrongPrefixSnapshot = await contractSnapshot(pool);
      await expect(executeIncremental(pool, lifecycleSql)).resolves.toEqual({
        errors: 1,
        results: [],
      });
      expect(await journalRows(pool)).toEqual(wrongPrefixJournal);
      expect(await targetColumns(pool)).toHaveLength(0);
      expect(await contractSnapshot(pool)).toEqual(wrongPrefixSnapshot);
    }, 120_000);

    it("rejects 0017 parent identity and key drift before creating its table", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const workTaskVisit = migrations[17];
      expect(workTaskVisit?.sqlFileName).toBe(`${workTaskVisitTag}.sql`);

      const [identityRows] = await pool.query<DatabaseIdentityRow[]>(
        "SELECT DATABASE() AS database_name, VERSION() AS server_version",
      );
      const identity = identityRows[0];
      if (!identity) throw new Error("Disposable MariaDB identity is missing.");
      const summary = await buildIncremental({
        migrationTag: workTaskVisitTag,
        outputDirectory,
        projectRoot: repositoryRoot,
        serverVersionSha256: createHash("sha256")
          .update(identity.server_version, "utf8")
          .digest("hex"),
        targetDatabaseSha256: createHash("sha256")
          .update(identity.database_name, "utf8")
          .digest("hex"),
      });
      const sql = await readFile(
        path.resolve(repositoryRoot, summary.sqlPath),
        "utf8",
      );

      await seedJournalPrefix(pool, migrations, 17);
      await pool.query(
        "ALTER TABLE `work_task_project` DROP FOREIGN KEY `fk_work_task_project_task`",
      );
      await pool.query(
        "ALTER TABLE `work_task` MODIFY `id` char(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL",
      );
      await pool.query(
        "ALTER TABLE `monthly_visit_commitment` DROP PRIMARY KEY",
      );

      const journalBefore = await journalRows(pool);
      const [targetBefore] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS target_count
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'work_task_visit'`,
      );
      const [triggersBefore] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS trigger_count
           FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = DATABASE()`,
      );
      expect(Number(targetBefore[0]?.target_count)).toBe(0);
      expect(Number(triggersBefore[0]?.trigger_count)).toBe(0);

      await expect(executeIncremental(pool, sql)).resolves.toEqual({
        errors: 1,
        results: [],
      });

      const [targetAfter] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS target_count
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'work_task_visit'`,
      );
      const [triggersAfter] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS trigger_count
           FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = DATABASE()`,
      );
      expect(await journalRows(pool)).toEqual(journalBefore);
      expect(Number(targetAfter[0]?.target_count)).toBe(0);
      expect(Number(triggersAfter[0]?.trigger_count)).toBe(0);
    }, 120_000);

    it("applies exact 0017 to 0018 once without changing existing business rows", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const previous = migrations[17];
      const planningExpenseCategories = migrations[18];
      expect(previous?.sqlFileName).toBe(`${workTaskVisitTag}.sql`);
      expect(planningExpenseCategories?.sqlFileName).toBe(
        `${planningExpenseCategoriesTag}.sql`,
      );

      const [identityRows] = await pool.query<DatabaseIdentityRow[]>(
        "SELECT DATABASE() AS database_name, VERSION() AS server_version",
      );
      const identity = identityRows[0];
      if (!identity) throw new Error("Disposable MariaDB identity is missing.");
      const summary = await buildIncremental({
        migrationTag: planningExpenseCategoriesTag,
        outputDirectory,
        projectRoot: repositoryRoot,
        serverVersionSha256: createHash("sha256")
          .update(identity.server_version, "utf8")
          .digest("hex"),
        targetDatabaseSha256: createHash("sha256")
          .update(identity.database_name, "utf8")
          .digest("hex"),
      });
      const sql = await readFile(
        path.resolve(repositoryRoot, summary.sqlPath),
        "utf8",
      );

      await seedJournalPrefix(pool, migrations, 18);
      expect(await journalRows(pool)).toHaveLength(18);
      await seedPlanningBusinessRows(pool);
      const businessRowsBefore = await planningBusinessRows(pool);

      await expect(executeIncremental(pool, sql, true)).resolves.toEqual({
        errors: 0,
        results: [
          {
            migrationTag: planningExpenseCategoriesTag,
            result: successResult,
          },
        ],
      });

      const journal19 = await journalRows(pool);
      expect(journal19).toHaveLength(19);
      expect(journal19.at(-1)).toEqual({
        created_at: planningExpenseCategories?.createdAt,
        hash: planningExpenseCategories?.hash,
        id: 19,
      });
      expect(await planningBusinessRows(pool)).toEqual(businessRowsBefore);

      const columns = await planningColumnMetadata(pool);
      expect(columns.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
        "expense_category.id",
        "expense_category.code",
        "expense_category.client_operation_key",
        "expense_category.display_name",
        "expense_category.is_system",
        "expense_category.status",
        "expense_category.version",
        "expense_category.created_at_utc",
        "expense_category.updated_at_utc",
        "monthly_visit_commitment.location_label",
      ]);
      expect(
        columns.find(
          (row) =>
            row.table_name === "expense_category" && row.column_name === "code",
        ),
      ).toEqual(
        expect.objectContaining({
          character_set_name: "ascii",
          collation_name: "ascii_bin",
          column_type: "varchar(32)",
          is_nullable: "NO",
        }),
      );
      expect(
        columns.find(
          (row) =>
            row.table_name === "monthly_visit_commitment" &&
            row.column_name === "location_label",
        ),
      ).toEqual(
        expect.objectContaining({
          character_set_name: "utf8mb4",
          collation_name: "utf8mb4_unicode_ci",
          column_type: "varchar(191)",
          is_nullable: "YES",
        }),
      );

      expect(await tableIndexes(pool, "expense_category")).toEqual([
        {
          columns_in_order: "id",
          index_name: "PRIMARY",
          non_unique: 0,
        },
        {
          columns_in_order: "status,display_name",
          index_name: "idx_expense_category_status_name",
          non_unique: 1,
        },
        {
          columns_in_order: "client_operation_key",
          index_name: "uq_expense_category_client_operation",
          non_unique: 0,
        },
        {
          columns_in_order: "code",
          index_name: "uq_expense_category_code",
          non_unique: 0,
        },
        {
          columns_in_order: "display_name",
          index_name: "uq_expense_category_display_name",
          non_unique: 0,
        },
      ]);
      expect(
        (await tableIndexes(pool, "expense_category")).map(
          (row) => row.index_name,
        ),
      ).toEqual([...planningExpenseCategoryIndexes]);

      const constraints = await namedConstraints(pool, [
        ...planningExpenseCategoryChecks,
        "chk_expense_category",
        "chk_monthly_visit_optional_fields",
        "fk_expense_category",
      ]);
      expect(constraints).toHaveLength(
        planningExpenseCategoryChecks.length + 3,
      );
      expect(constraints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            constraint_name: "chk_expense_category",
            constraint_type: "CHECK",
            table_name: "expense",
          }),
          expect.objectContaining({
            constraint_name: "chk_monthly_visit_optional_fields",
            constraint_type: "CHECK",
            table_name: "monthly_visit_commitment",
          }),
          expect.objectContaining({
            constraint_name: "fk_expense_category",
            constraint_type: "FOREIGN KEY",
            table_name: "expense",
          }),
        ]),
      );

      const checkClauses = await namedCheckClauses(pool, [
        "chk_expense_category",
        "chk_monthly_visit_optional_fields",
      ]);
      expect(checkClauses).toHaveLength(2);
      expect(
        String(
          checkClauses.find(
            (row) => row.constraint_name === "chk_expense_category",
          )?.check_clause,
        ),
      ).toMatch(/\^\[a-z\]\[a-z0-9_\]\{0,31\}\$/u);
      expect(
        String(
          checkClauses.find(
            (row) =>
              row.constraint_name === "chk_monthly_visit_optional_fields",
          )?.check_clause,
        ),
      ).toMatch(/location_label[\s\S]*resolution_note/iu);
      expect(await planningForeignKey(pool)).toEqual([
        {
          column_name: "category",
          constraint_name: "fk_expense_category",
          delete_rule: "RESTRICT",
          referenced_column_name: "code",
          referenced_table_name: "expense_category",
          table_name: "expense",
          update_rule: "RESTRICT",
        },
      ]);
      expect(await expenseCategorySeedRows(pool)).toEqual([
        {
          code: "external_service",
          display_name: "Dış hizmet",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "marketing",
          display_name: "Pazarlama",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "meals_hospitality",
          display_name: "Yemek / ağırlama",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "office",
          display_name: "Ofis",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "other",
          display_name: "Diğer",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "rent",
          display_name: "Kira",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "software_subscription",
          display_name: "Yazılım / abonelik",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "tax_fee",
          display_name: "Vergi / harç",
          is_system: 1,
          status: "active",
          version: 1,
        },
        {
          code: "transportation",
          display_name: "Ulaşım",
          is_system: 1,
          status: "active",
          version: 1,
        },
      ]);
      const [visitLocationRows] = await pool.query<RowDataPacket[]>(
        `SELECT location_label
           FROM monthly_visit_commitment
          WHERE id = ?`,
        [planningFixture.visitId],
      );
      expect(visitLocationRows).toEqual([{ location_label: null }]);

      const completedState = {
        business: await planningBusinessRows(pool),
        migration: await planningMigrationState(pool),
        seeds: await expenseCategorySeedRows(pool),
      };
      await expect(executeIncremental(pool, sql)).resolves.toEqual({
        errors: 1,
        results: [],
      });
      expect({
        business: await planningBusinessRows(pool),
        migration: await planningMigrationState(pool),
        seeds: await expenseCategorySeedRows(pool),
      }).toEqual(completedState);
    }, 180_000);

    it("rejects a wrong 0017 prefix and prerequisite drift before 0018 DDL", async () => {
      const migrations = await readExpectedMigrations(
        path.join(repositoryRoot, "drizzle"),
      );
      const planningExpenseCategories = migrations[18];
      expect(planningExpenseCategories?.sqlFileName).toBe(
        `${planningExpenseCategoriesTag}.sql`,
      );

      const [identityRows] = await pool.query<DatabaseIdentityRow[]>(
        "SELECT DATABASE() AS database_name, VERSION() AS server_version",
      );
      const identity = identityRows[0];
      if (!identity) throw new Error("Disposable MariaDB identity is missing.");
      const summary = await buildIncremental({
        migrationTag: planningExpenseCategoriesTag,
        outputDirectory,
        projectRoot: repositoryRoot,
        serverVersionSha256: createHash("sha256")
          .update(identity.server_version, "utf8")
          .digest("hex"),
        targetDatabaseSha256: createHash("sha256")
          .update(identity.database_name, "utf8")
          .digest("hex"),
      });
      const sql = await readFile(
        path.resolve(repositoryRoot, summary.sqlPath),
        "utf8",
      );

      await seedJournalPrefix(pool, migrations, 18);
      await pool.execute(
        `UPDATE \`${journalTable}\` SET hash = ? WHERE id = 18`,
        ["0".repeat(64)],
      );
      const wrongPrefixBefore = await planningMigrationState(pool);
      await expect(executeIncremental(pool, sql)).resolves.toEqual({
        errors: 1,
        results: [],
      });
      expect(await planningMigrationState(pool)).toEqual(wrongPrefixBefore);

      const driftCases: ReadonlyArray<{
        mutate: () => Promise<unknown>;
        name: string;
      }> = [
        {
          mutate: () =>
            pool.query(
              "ALTER TABLE `monthly_visit_commitment` DROP CONSTRAINT `chk_monthly_visit_optional_fields`",
            ),
          name: "required visit check missing",
        },
        {
          mutate: () =>
            pool.query(
              "ALTER TABLE `monthly_visit_commitment` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci",
            ),
          name: "visit table default collation drifted",
        },
        {
          mutate: () =>
            pool.query(
              "ALTER TABLE `expense` MODIFY `category` varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL",
            ),
          name: "expense category column collation drifted",
        },
        {
          mutate: () =>
            pool.query(
              "ALTER TABLE `monthly_visit_commitment` ADD `location_label` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            ),
          name: "visit location target already exists",
        },
        {
          mutate: async () => {
            await pool.query(
              "ALTER TABLE `expense` DROP CONSTRAINT `chk_expense_category`",
            );
            return pool.query(
              "ALTER TABLE `expense` ADD CONSTRAINT `chk_expense_category` CHECK (`category` IS NOT NULL)",
            );
          },
          name: "legacy expense category check clause drifted",
        },
        {
          mutate: async () => {
            await pool.query(
              "ALTER TABLE `monthly_visit_commitment` DROP CONSTRAINT `chk_monthly_visit_optional_fields`",
            );
            return pool.query(
              "ALTER TABLE `monthly_visit_commitment` ADD CONSTRAINT `chk_monthly_visit_optional_fields` CHECK (`resolution_note` IS NULL OR CHAR_LENGTH(`resolution_note`) BETWEEN 1 AND 1999)",
            );
          },
          name: "legacy visit optional-fields check clause drifted",
        },
        {
          mutate: async () => {
            await pool.query(
              "ALTER TABLE `expense` DROP CONSTRAINT `chk_expense_category`",
            );
            await pool.query(
              "ALTER TABLE `expense` ADD CONSTRAINT `chk_expense_category` CHECK (CHAR_LENGTH(`category`) BETWEEN 1 AND 32)",
            );
            return pool.execute(
              "UPDATE `expense` SET `category` = 'unseeded_category' WHERE `id` = ?",
              [planningFixture.expenseId],
            );
          },
          name: "expense contains a category outside the exact seed",
        },
      ];

      for (const driftCase of driftCases) {
        await seedJournalPrefix(pool, migrations, 18);
        await seedPlanningBusinessRows(pool);
        await driftCase.mutate();
        const driftedBusinessBefore = await planningBusinessRows(pool);
        const driftedSchemaBefore = await planningMigrationState(pool);

        await expect(
          executeIncremental(pool, sql),
          driftCase.name,
        ).resolves.toEqual({ errors: 1, results: [] });
        expect(
          await planningBusinessRows(pool),
          driftCase.name,
        ).toEqual(driftedBusinessBefore);
        expect(
          await planningMigrationState(pool),
          driftCase.name,
        ).toEqual(driftedSchemaBefore);
      }
    }, 240_000);
  },
);
