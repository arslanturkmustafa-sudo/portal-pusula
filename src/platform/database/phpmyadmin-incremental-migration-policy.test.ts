import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The deployment artifact builder is intentionally plain Node ESM.
import * as untypedModule from "../../../scripts/build-phpmyadmin-incremental-migration.mjs";

const {
  analyzeIncrementalMigrationStatement: untypedAnalyze,
  buildPhpMyAdminIncrementalMigrationBundle: untypedBuild,
  incrementalMigration0011BackfillStatements: untyped0011Backfills,
} = untypedModule;

interface BuildSummary {
  bundleId: string;
  manifestPath: string;
  migrationTag: string;
  sqlBytes: number;
  sqlPath: string;
  sqlSha256: string;
  statementCount: number;
}

interface IncrementalManifest {
  boundary: string;
  bundleId: string;
  expectedJournalCount: number;
  expectedPreviousMigration: {
    createdAt: number;
    hash: string;
    tag: string;
  };
  migration: {
    createdAt: number;
    hash: string;
    statementHashes: string[];
    tag: string;
  };
  sqlSha256: string;
  targetObjects: Array<{ name: string; tableName: string; type: string }>;
}

const buildPhpMyAdminIncrementalMigrationBundle = untypedBuild as (options: {
  migrationTag: string;
  outputDirectory: string;
  projectRoot: string;
  serverVersionSha256: string;
  targetDatabaseSha256: string;
}) => Promise<BuildSummary>;
const analyzeIncrementalMigrationStatement = untypedAnalyze as (
  statement: string,
  migrationTag: string,
) => Record<string, unknown>;

const customerProjectsPartnershipMigrationTag =
  "0011_customer_projects_partnership";
const userPermissionsMigrationTag = "0012_user_permissions";
const recordLifecycleMigrationTag = "0014_record_lifecycle";
const financialReversalsMigrationTag = "0015_financial_reversals";
const financeAccountsLedgerMigrationTag = "0016_finance_accounts_ledger";
const workTaskVisitMigrationTag = "0017_work_task_visit";
const planningExpenseCategoriesMigrationTag =
  "0018_planning_expense_categories";
const taxObligationsMigrationTag = "0019_tax_obligations";
const expenseAccountLedgerMigrationTag = "0020_expense_account_ledger";
const incremental0011Backfills = untyped0011Backfills as {
  consultingContract: string;
  customerProject: string;
  receivable: string;
};
const customerProjectBackfill = incremental0011Backfills.customerProject;
const consultingContractBackfill =
  incremental0011Backfills.consultingContract;
const receivableBackfill = incremental0011Backfills.receivable;

const projectRoot = process.cwd();
const targetDatabaseNameFixture = "incremental_target_name_must_not_leak";
const serverVersionFixture = "11.8.3-MariaDB-hosting-fixture";
const targetDatabaseSha256 = createHash("sha256")
  .update(targetDatabaseNameFixture)
  .digest("hex");
const serverVersionSha256 = createHash("sha256")
  .update(serverVersionFixture)
  .digest("hex");
const outputDirectories: string[] = [];

async function temporaryOutputDirectory() {
  const directory = await mkdtemp(
    resolve(tmpdir(), "portal-pusula-incremental-bundle-"),
  );
  outputDirectories.push(directory);
  return directory;
}

async function fixtureProject(migrationSql: string) {
  const root = await mkdtemp(
    resolve(tmpdir(), "portal-pusula-incremental-project-"),
  );
  outputDirectories.push(root);
  await mkdir(resolve(root, "drizzle", "meta"), { recursive: true });
  await writeFile(
    resolve(root, "drizzle", "0000_fixture.sql"),
    "SELECT 1\n",
  );
  await writeFile(
    resolve(root, "drizzle", `${customerProjectsPartnershipMigrationTag}.sql`),
    `${migrationSql}\n`,
  );
  await writeFile(
    resolve(root, "drizzle", "meta", "_journal.json"),
    `${JSON.stringify({
      dialect: "mysql",
      entries: [
        {
          breakpoints: true,
          idx: 0,
          tag: "0000_fixture",
          version: "5",
          when: 1,
        },
        {
          breakpoints: true,
          idx: 1,
          tag: customerProjectsPartnershipMigrationTag,
          version: "5",
          when: 2,
        },
      ],
      version: "7",
    })}\n`,
  );
  return root;
}

async function buildFixture(migrationSql: string) {
  const fixtureRoot = await fixtureProject(migrationSql);
  const outputDirectory = resolve(fixtureRoot, "dist");
  const summary = await buildPhpMyAdminIncrementalMigrationBundle({
    migrationTag: customerProjectsPartnershipMigrationTag,
    outputDirectory,
    projectRoot: fixtureRoot,
    serverVersionSha256,
    targetDatabaseSha256,
  });
  const sql = await readFile(resolve(fixtureRoot, summary.sqlPath), "utf8");
  const manifestText = await readFile(
    resolve(fixtureRoot, summary.manifestPath),
    "utf8",
  );
  return {
    manifest: JSON.parse(manifestText) as IncrementalManifest,
    sql,
    summary,
  };
}

async function build(outputDirectory: string) {
  const summary = await buildPhpMyAdminIncrementalMigrationBundle({
    migrationTag: "0010_expenses_cards",
    outputDirectory,
    projectRoot,
    serverVersionSha256,
    targetDatabaseSha256,
  });
  const sql = await readFile(resolve(projectRoot, summary.sqlPath), "utf8");
  const manifestText = await readFile(
    resolve(projectRoot, summary.manifestPath),
    "utf8",
  );
  return {
    manifest: JSON.parse(manifestText) as IncrementalManifest,
    manifestText,
    sql,
    summary,
  };
}

async function build0011(outputDirectory: string) {
  const summary = await buildPhpMyAdminIncrementalMigrationBundle({
    migrationTag: customerProjectsPartnershipMigrationTag,
    outputDirectory,
    projectRoot,
    serverVersionSha256,
    targetDatabaseSha256,
  });
  const sql = await readFile(resolve(projectRoot, summary.sqlPath), "utf8");
  const manifestText = await readFile(
    resolve(projectRoot, summary.manifestPath),
    "utf8",
  );
  return {
    manifest: JSON.parse(manifestText) as IncrementalManifest,
    sql,
    summary,
  };
}

async function build0012(outputDirectory: string) {
  const summary = await buildPhpMyAdminIncrementalMigrationBundle({
    migrationTag: userPermissionsMigrationTag,
    outputDirectory,
    projectRoot,
    serverVersionSha256,
    targetDatabaseSha256,
  });
  const sql = await readFile(resolve(projectRoot, summary.sqlPath), "utf8");
  const manifestText = await readFile(
    resolve(projectRoot, summary.manifestPath),
    "utf8",
  );
  return {
    manifest: JSON.parse(manifestText) as IncrementalManifest,
    sql,
    summary,
  };
}

async function buildCurrentIncremental(
  migrationTag: string,
  outputDirectory: string,
) {
  const summary = await buildPhpMyAdminIncrementalMigrationBundle({
    migrationTag,
    outputDirectory,
    projectRoot,
    serverVersionSha256,
    targetDatabaseSha256,
  });
  const sql = await readFile(resolve(projectRoot, summary.sqlPath), "utf8");
  const manifestText = await readFile(
    resolve(projectRoot, summary.manifestPath),
    "utf8",
  );
  return {
    manifest: JSON.parse(manifestText) as IncrementalManifest,
    sql,
    summary,
  };
}

function candidateStatements(sql: string): string[] {
  return [...sql.matchAll(/SET @pp_candidate_sql = 0x([0-9a-f]+);/gu)].map(
    (match) => Buffer.from(match[1], "hex").toString("utf8"),
  );
}

afterEach(async () => {
  await Promise.all(
    outputDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe.sequential("phpMyAdmin incremental migration bundle policy", () => {
  it("builds a deterministic, target-bound 0010 artifact", async () => {
    const outputDirectory = await temporaryOutputDirectory();
    const first = await build(outputDirectory);
    const second = await build(outputDirectory);

    expect(second).toEqual(first);
    expect(first.summary.statementCount).toBe(12);
    expect(first.summary.sqlBytes).toBe(Buffer.byteLength(first.sql));
    expect(first.summary.sqlSha256).toBe(
      createHash("sha256").update(first.sql).digest("hex"),
    );
    expect(first.manifest.sqlSha256).toBe(first.summary.sqlSha256);
    expect(first.sql).toContain(targetDatabaseSha256);
    expect(first.sql).toContain(serverVersionSha256);
    expect(first.sql).not.toContain(targetDatabaseNameFixture);
    expect(first.sql).not.toContain(serverVersionFixture);
  });

  it("builds the real 0011 artifact with the exact forward-safe order and legacy backfills", async () => {
    const first = await build0011(await temporaryOutputDirectory());
    const second = await build0011(await temporaryOutputDirectory());
    const migrationSql = await readFile(
      resolve(projectRoot, "drizzle", `${customerProjectsPartnershipMigrationTag}.sql`),
      "utf8",
    );
    const migrationStatements = migrationSql
      .split(/--> statement-breakpoint\s*/gu)
      .map((statement) => statement.trim().replace(/;$/u, ""));

    expect(second.summary.statementCount).toBe(first.summary.statementCount);
    expect(first.summary.statementCount).toBe(25);
    expect(first.manifest.expectedJournalCount).toBe(11);
    expect(first.manifest.expectedPreviousMigration.tag).toBe(
      "0010_expenses_cards",
    );
    expect(first.manifest.migration.tag).toBe(
      customerProjectsPartnershipMigrationTag,
    );
    expect(first.manifest.migration.statementHashes).toHaveLength(25);
    expect(candidateStatements(first.sql)).toEqual([
      ...migrationStatements,
      expect.stringContaining("INSERT INTO `__drizzle_migrations`"),
    ]);

    expect(migrationStatements.slice(0, 4).every((statement) =>
      statement.startsWith("CREATE TABLE"),
    )).toBe(true);
    expect(migrationStatements.slice(0, 4).join("\n")).toContain(
      "CHARACTER SET ascii COLLATE ascii_bin",
    );
    expect(migrationStatements).toContain(customerProjectBackfill);
    expect(migrationStatements).toContain(consultingContractBackfill);
    expect(migrationStatements).toContain(receivableBackfill);
    expect(migrationStatements.at(-1)).toBe(
      "DROP INDEX `uq_consulting_contract_customer_start` ON `consulting_contract`",
    );
    expect(
      migrationStatements.indexOf(consultingContractBackfill),
    ).toBeLessThan(
      migrationStatements.indexOf(
        "ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_customer_project` FOREIGN KEY (`customer_id`,`project_id`) REFERENCES `customer_project`(`customer_id`,`project_id`) ON DELETE restrict ON UPDATE restrict",
      ),
    );
  });

  it("builds a target-bound 0012 user-permission artifact with exact transitional guards", async () => {
    const first = await build0012(await temporaryOutputDirectory());
    const second = await build0012(await temporaryOutputDirectory());
    const migrationSql = await readFile(
      resolve(projectRoot, "drizzle", `${userPermissionsMigrationTag}.sql`),
      "utf8",
    );
    const migrationStatements = migrationSql
      .split(/--> statement-breakpoint\s*/gu)
      .map((statement) => statement.trim().replace(/;$/u, ""));

    expect(second.summary).toMatchObject({
      migrationTag: userPermissionsMigrationTag,
      statementCount: 7,
    });
    expect(first.manifest.expectedJournalCount).toBe(12);
    expect(first.manifest.expectedPreviousMigration.tag).toBe(
      customerProjectsPartnershipMigrationTag,
    );
    expect(first.manifest.migration.tag).toBe(userPermissionsMigrationTag);
    expect(first.manifest.migration.statementHashes).toHaveLength(7);
    expect(candidateStatements(first.sql)).toEqual([
      ...migrationStatements,
      expect.stringContaining("INSERT INTO `__drizzle_migrations`"),
    ]);
    expect(first.manifest.targetObjects).toEqual(
      expect.arrayContaining([
        {
          name: "chk_user_account_state",
          tableName: "user_account",
          type: "drop-check",
        },
        {
          name: "display_name,role",
          tableName: "user_account",
          type: "add-user-account-columns",
        },
        {
          name: "display_name,role",
          tableName: "user_account",
          type: "modify-user-account-columns",
        },
        {
          name: "user_permission",
          tableName: "user_permission",
          type: "create-table",
        },
        {
          name: "idx_user_account_role_status",
          tableName: "user_account",
          type: "create-index",
        },
      ]),
    );
    expect(first.sql).toContain("COLUMN_NAME IN ('display_name', 'role')) = 0");
    expect(first.sql).toContain("REPLACE(COLUMN_DEFAULT, '''', '') = 'owner'");
    expect(first.sql).toContain("REPLACE(COLUMN_DEFAULT, '''', '') = 'member'");
    const initialGuard = first.sql.slice(
      0,
      first.sql.indexOf("SET @pp_candidate_sql = 0x"),
    );
    expect(initialGuard).toContain(
      "CONSTRAINT_NAME = 'chk_user_account_state' AND CONSTRAINT_TYPE = 'CHECK') = 1",
    );
    expect(initialGuard.match(/chk_user_account_state/gu)).toHaveLength(1);
    expect(first.sql).not.toContain("PORTAL_PUSULA_INVALID_SQL_MODE");
  });

  it("accepts only the exact 0012 user-account transition statements", async () => {
    const migrationSql = await readFile(
      resolve(projectRoot, "drizzle", `${userPermissionsMigrationTag}.sql`),
      "utf8",
    );
    const statements = migrationSql
      .split(/--> statement-breakpoint\s*/gu)
      .map((statement) => statement.trim().replace(/;$/u, ""));

    expect(
      statements.map((statement) =>
        analyzeIncrementalMigrationStatement(statement, userPermissionsMigrationTag),
      ),
    ).toHaveLength(7);
    expect(() =>
      analyzeIncrementalMigrationStatement(
        statements[0].replace("chk_user_account_state", "chk_other"),
        userPermissionsMigrationTag,
      ),
    ).toThrow();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        statements[1].replace("DEFAULT 'owner'", "DEFAULT 'member'"),
        userPermissionsMigrationTag,
      ),
    ).toThrow();
  });

  it.each([
    {
      expectedJournalCount: 14,
      expectedPreviousTag: "0013_login_attempt_throttle",
      migrationTag: recordLifecycleMigrationTag,
      requiredTarget: {
        name: "archive_reason",
        tableName: "customer",
        type: "add-column",
      },
      statementCount: 44,
    },
    {
      expectedJournalCount: 15,
      expectedPreviousTag: recordLifecycleMigrationTag,
      migrationTag: financialReversalsMigrationTag,
      requiredTarget: {
        name: "uq_receivable_collection_reversal",
        tableName: "receivable_collection",
        type: "create-index",
      },
      statementCount: 26,
    },
    {
      expectedJournalCount: 16,
      expectedPreviousTag: financialReversalsMigrationTag,
      migrationTag: financeAccountsLedgerMigrationTag,
      requiredTarget: {
        name: "finance_account",
        tableName: "finance_account",
        type: "create-table",
      },
      statementCount: 15,
    },
    {
      expectedJournalCount: 17,
      expectedPreviousTag: financeAccountsLedgerMigrationTag,
      migrationTag: workTaskVisitMigrationTag,
      requiredTarget: {
        name: "work_task_visit",
        tableName: "work_task_visit",
        type: "create-table",
      },
      statementCount: 4,
    },
    {
      expectedJournalCount: 18,
      expectedPreviousTag: workTaskVisitMigrationTag,
      migrationTag: planningExpenseCategoriesMigrationTag,
      requiredTarget: {
        name: "seed_expense_category",
        tableName: "expense_category",
        type: "data-seed",
      },
      statementCount: 9,
    },
    {
      expectedJournalCount: 19,
      expectedPreviousTag: planningExpenseCategoriesMigrationTag,
      migrationTag: taxObligationsMigrationTag,
      requiredTarget: {
        name: "tax_obligation",
        tableName: "tax_obligation",
        type: "create-table",
      },
      statementCount: 4,
    },
    {
      expectedJournalCount: 20,
      expectedPreviousTag: taxObligationsMigrationTag,
      migrationTag: expenseAccountLedgerMigrationTag,
      requiredTarget: {
        name: "source_account_id",
        tableName: "expense",
        type: "add-column",
      },
      statementCount: 8,
    },
  ])(
    "builds deterministic guarded $migrationTag artifact",
    async ({
      expectedJournalCount,
      expectedPreviousTag,
      migrationTag,
      requiredTarget,
      statementCount,
    }) => {
      const first = await buildCurrentIncremental(
        migrationTag,
        await temporaryOutputDirectory(),
      );
      const second = await buildCurrentIncremental(
        migrationTag,
        await temporaryOutputDirectory(),
      );

      expect(second.summary).toMatchObject({ migrationTag, statementCount });
      expect(first.summary.sqlSha256).toBe(second.summary.sqlSha256);
      expect(first.manifest.expectedJournalCount).toBe(expectedJournalCount);
      expect(first.manifest.expectedPreviousMigration.tag).toBe(
        expectedPreviousTag,
      );
      expect(first.manifest.targetObjects).toContainEqual(requiredTarget);
      expect(first.manifest.migration.statementHashes).toHaveLength(
        statementCount,
      );
      expect(first.sql).toContain(
        Buffer.from("PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK", "utf8").toString(
          "hex",
        ),
      );
      if (migrationTag === recordLifecycleMigrationTag) {
        const initialGuard = first.sql.slice(
          0,
          first.sql.indexOf("SET @pp_candidate_sql = 0x"),
        );
        expect(initialGuard).toContain(
          "INDEX_NAME = 'idx_customer_status_name') = 2",
        );
        expect(initialGuard).not.toContain(
          "TABLE_NAME = 'customer' AND INDEX_NAME = 'idx_customer_status_name') = 0",
        );
      }
    },
  );

  it("allows only the exact 0020 expense-ledger DDL and guards both parent identities", async () => {
    const migrationSql = await readFile(
      resolve(
        projectRoot,
        "drizzle",
        `${expenseAccountLedgerMigrationTag}.sql`,
      ),
      "utf8",
    );
    const migrationStatements = migrationSql
      .split(/--> statement-breakpoint\s*/gu)
      .map((statement) => statement.trim().replace(/;$/u, ""));
    const artifact = await buildCurrentIncremental(
      expenseAccountLedgerMigrationTag,
      await temporaryOutputDirectory(),
    );
    const initialGuard = artifact.sql.slice(
      0,
      artifact.sql.indexOf("SET @pp_candidate_sql = 0x"),
    );

    expect(
      migrationStatements.map((statement) =>
        analyzeIncrementalMigrationStatement(
          statement,
          expenseAccountLedgerMigrationTag,
        ),
      ),
    ).toHaveLength(8);
    expect(artifact.manifest.migration).toMatchObject({
      createdAt: 1788938626518,
      hash: "a95bed1c3e8f65d71a5063423ceefbfc676678c03699e2d89d098f1b31811226",
      tag: expenseAccountLedgerMigrationTag,
    });
    expect(artifact.manifest.targetObjects).toEqual(
      expect.arrayContaining([
        {
          name: "finance_transaction_id",
          tableName: "expense",
          type: "add-column",
        },
        {
          name: "uq_expense_finance_transaction",
          tableName: "expense",
          type: "create-index",
        },
        {
          name: "chk_expense_account_movement_shape",
          tableName: "expense",
          type: "check",
        },
        {
          name: "fk_expense_source_account",
          tableName: "expense",
          type: "foreign-key",
        },
        {
          name: "fk_expense_finance_transaction",
          tableName: "expense",
          type: "foreign-key",
        },
      ]),
    );
    expect(initialGuard).toContain(
      "TABLE_NAME = 'expense' AND COLUMN_NAME = 'payment_method' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(24)'",
    );
    for (const tableName of ["finance_account", "finance_transaction"]) {
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'id' AND DATA_TYPE = 'char' AND COLUMN_TYPE = 'char(36)'`,
      );
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND CONSTRAINT_NAME = 'PRIMARY' AND CONSTRAINT_TYPE = 'PRIMARY KEY') = 1`,
      );
    }

    const movementCheck = migrationStatements.find((statement) =>
      statement.includes("chk_expense_account_movement_shape"),
    );
    const sourceForeignKey = migrationStatements.find((statement) =>
      statement.includes("fk_expense_source_account"),
    );
    expect(movementCheck).toBeDefined();
    expect(sourceForeignKey).toBeDefined();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        movementCheck!.replace("BINARY 'bank_transfer'", "BINARY 'other'"),
        expenseAccountLedgerMigrationTag,
      ),
    ).toThrow();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        sourceForeignKey!.replace("`finance_account`", "`user_account`"),
        expenseAccountLedgerMigrationTag,
      ),
    ).toThrow();
  });

  it("guards the exact 0018 category catalog, seed, and expense ownership", async () => {
    const first = await buildCurrentIncremental(
      planningExpenseCategoriesMigrationTag,
      await temporaryOutputDirectory(),
    );
    const statements = candidateStatements(first.sql);
    const createCategory = statements.find((statement) =>
      statement.startsWith("CREATE TABLE `expense_category`"),
    );
    const categorySeed = statements.find((statement) =>
      statement.startsWith("INSERT INTO `expense_category`"),
    );
    const initialGuard = first.sql.slice(
      0,
      first.sql.indexOf("SET @pp_candidate_sql = 0x"),
    );

    expect(first.manifest.migration).toMatchObject({
      createdAt: 1788799557949,
      hash: "48286e594051f082b85891e043f9578dfa2105fb50aef98b878e8d476cdbba6f",
      tag: planningExpenseCategoriesMigrationTag,
    });
    expect(first.manifest.targetObjects).toEqual(
      expect.arrayContaining([
        {
          name: "expense_category",
          tableName: "expense_category",
          type: "create-table",
        },
        {
          name: "seed_expense_category",
          tableName: "expense_category",
          type: "data-seed",
        },
        {
          name: "fk_expense_category",
          tableName: "expense",
          type: "foreign-key",
        },
      ]),
    );
    expect(createCategory).toContain(
      "CONSTRAINT `uq_expense_category_display_name` UNIQUE(`display_name`)",
    );
    expect(statements).toContain(
      "ALTER TABLE `monthly_visit_commitment` ADD `location_label` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
    expect(categorySeed?.match(/'81000000-/gu)).toHaveLength(9);
    expect(initialGuard).toContain("TABLE_NAME = 'expense_category'");
    expect(initialGuard).not.toContain("FROM `expense_category`");
    expect(initialGuard).toContain(
      "TABLE_NAME = 'monthly_visit_commitment' AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB' AND TABLE_COLLATION = 'utf8mb4_unicode_ci') = 1",
    );
    expect(initialGuard).toContain(
      "TABLE_NAME = 'monthly_visit_commitment' AND COLUMN_NAME = 'location_label') = 0",
    );
    expect(initialGuard).toContain(
      "TABLE_NAME = 'expense' AND COLUMN_NAME = 'category' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(32)' AND CHARACTER_MAXIMUM_LENGTH = 32 AND CHARACTER_SET_NAME = 'ascii' AND COLLATION_NAME = 'ascii_bin' AND IS_NULLABLE = 'NO' AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL') AND EXTRA = '') = 1",
    );
    expect(initialGuard).toContain(
      "FROM `expense` WHERE BINARY `category` NOT IN (BINARY 'rent'",
    );
    expect(initialGuard).toContain(
      "information_schema.CHECK_CONSTRAINTS cc",
    );
    expect(initialGuard).toContain(
      "BINARY cc.CHECK_CLAUSE = BINARY 'cast(`category` as char charset binary) in (cast(''rent'' as char charset binary)",
    );
    expect(initialGuard).toContain(
      "BINARY cc.CHECK_CLAUSE = BINARY '`resolution_note` is null or char_length(`resolution_note`) between 1 and 2000'",
    );
    expect(first.sql).toContain(
      "TABLE_NAME = 'expense_category' AND COLUMN_NAME = 'code' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(32)' AND CHARACTER_MAXIMUM_LENGTH = 32 AND CHARACTER_SET_NAME = 'ascii' AND COLLATION_NAME = 'ascii_bin' AND IS_NULLABLE = 'NO'",
    );
    expect(first.sql).toContain(
      "TABLE_NAME = 'expense_category' AND CONSTRAINT_NAME = 'uq_expense_category_code' AND CONSTRAINT_TYPE = 'UNIQUE') = 1",
    );
    expect(first.sql).toContain(
      "TABLE_NAME = 'monthly_visit_commitment' AND COLUMN_NAME = 'location_label' AND DATA_TYPE = 'varchar' AND IS_NULLABLE = 'YES' AND EXTRA = '' AND CHARACTER_MAXIMUM_LENGTH = 191 AND COLUMN_TYPE = 'varchar(191)' AND CHARACTER_SET_NAME = 'utf8mb4' AND COLLATION_NAME = 'utf8mb4_unicode_ci'",
    );
    expect(first.sql).toContain(
      "BINARY cc.CHECK_CLAUSE = BINARY 'char_length(`category`) between 1 and 32 and cast(`category` as char charset binary) regexp ''^[a-z][a-z0-9_]{0,31}$'''",
    );
    expect(first.sql).toContain(
      "BINARY cc.CHECK_CLAUSE = BINARY '(`location_label` is null or char_length(`location_label`) between 1 and 191 and `location_label` = trim(`location_label`)) and (`resolution_note` is null or char_length(`resolution_note`) between 1 and 2000)'",
    );
    expect(first.sql).not.toContain("INSERT INTO `expense_category`");
  });

  it("accepts only the explicit utf8mb4 visit-location definition for 0018", () => {
    const exact =
      "ALTER TABLE `monthly_visit_commitment` ADD `location_label` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci";

    expect(
      analyzeIncrementalMigrationStatement(
        exact,
        planningExpenseCategoriesMigrationTag,
      ),
    ).toMatchObject({
      columnName: "location_label",
      columnSpec: {
        characterSet: "utf8mb4",
        collation: "utf8mb4_unicode_ci",
        columnType: "varchar(191)",
        nullable: true,
      },
      tableName: "monthly_visit_commitment",
      type: "add-column",
    });
    expect(() =>
      analyzeIncrementalMigrationStatement(
        exact.replace(
          " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
          "",
        ),
        planningExpenseCategoriesMigrationTag,
      ),
    ).toThrow();
  });

  it("guards both 0017 parent identifiers and primary keys before any DDL", async () => {
    const first = await buildCurrentIncremental(
      workTaskVisitMigrationTag,
      await temporaryOutputDirectory(),
    );
    const second = await buildCurrentIncremental(
      workTaskVisitMigrationTag,
      await temporaryOutputDirectory(),
    );
    const initialGuard = first.sql.slice(
      0,
      first.sql.indexOf("SET @pp_candidate_sql = 0x"),
    );

    expect(first.summary).toMatchObject({
      migrationTag: workTaskVisitMigrationTag,
      statementCount: 4,
    });
    expect(first.summary.sqlSha256).toBe(second.summary.sqlSha256);
    expect(first.manifest.migration.statementHashes).toHaveLength(4);
    expect(initialGuard).not.toContain("TRIGGER");

    for (const tableName of ["work_task", "monthly_visit_commitment"]) {
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND COLUMN_NAME = 'id' AND DATA_TYPE = 'char' AND COLUMN_TYPE = 'char(36)' AND CHARACTER_MAXIMUM_LENGTH = 36 AND CHARACTER_SET_NAME = 'ascii' AND COLLATION_NAME = 'ascii_bin' AND IS_NULLABLE = 'NO'`,
      );
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND CONSTRAINT_NAME = 'PRIMARY' AND CONSTRAINT_TYPE = 'PRIMARY KEY') = 1`,
      );
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND INDEX_NAME = 'PRIMARY') = 1`,
      );
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND INDEX_NAME = 'PRIMARY' AND NON_UNIQUE = 0 AND INDEX_TYPE = 'BTREE') = 1`,
      );
      expect(initialGuard).toContain(
        `TABLE_NAME = '${tableName}' AND INDEX_NAME = 'PRIMARY' AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'id' AND NON_UNIQUE = 0) = 1`,
      );
    }

    expect(
      candidateStatements(first.sql).filter((statement) =>
        /\b(?:CREATE|ALTER|DROP)\b/iu.test(statement),
      ),
    ).toHaveLength(4);
    expect(candidateStatements(first.sql).join("\n")).not.toMatch(
      /\bTRIGGER\b/iu,
    );
  });

  it("rejects mutated lifecycle and reversal column definitions", () => {
    expect(() =>
      analyzeIncrementalMigrationStatement(
        "ALTER TABLE `customer` ADD `archive_reason` varchar(500) NOT NULL",
        recordLifecycleMigrationTag,
      ),
    ).toThrow();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        "ALTER TABLE `receivable` ADD `record_state` varchar(16) DEFAULT 'voided' NOT NULL",
        financialReversalsMigrationTag,
      ),
    ).toThrow();
  });

  it("allows the exact finance permission check replacement only in 0016", () => {
    const statement =
      "ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`";

    expect(
      analyzeIncrementalMigrationStatement(
        statement,
        financeAccountsLedgerMigrationTag,
      ),
    ).toMatchObject({
      constraintName: "chk_user_permission_code",
      tableName: "user_permission",
      type: "drop-check",
    });
    expect(() =>
      analyzeIncrementalMigrationStatement(
        statement.replace("chk_user_permission_code", "chk_other"),
        financeAccountsLedgerMigrationTag,
      ),
    ).toThrow();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        statement,
        workTaskVisitMigrationTag,
      ),
    ).toThrow();
  });

  it("requires the exact previous journal and records the selected hash", async () => {
    const { manifest, sql } = await build(await temporaryOutputDirectory());

    expect(manifest.expectedJournalCount).toBe(10);
    expect(manifest.expectedPreviousMigration.tag).toBe(
      "0009_projects",
    );
    expect(manifest.migration.tag).toBe("0010_expenses_cards");
    expect(manifest.migration.statementHashes).toHaveLength(12);
    expect(sql).toContain(manifest.expectedPreviousMigration.hash);
    expect(sql).toContain(manifest.migration.hash);
    expect(sql).toContain(String(manifest.migration.createdAt));
    expect(sql).toContain(
      Buffer.from("PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK", "utf8").toString(
        "hex",
      ),
    );
    const journalInsert = candidateStatements(sql).find((statement) =>
      statement.startsWith("INSERT INTO `__drizzle_migrations`"),
    );
    expect(journalInsert).toContain("WHERE NOT EXISTS");
  });

  it("converts breakpoints to guarded phpMyAdmin statements and refuses partial reruns", async () => {
    const { manifest, sql } = await build(await temporaryOutputDirectory());

    expect(sql).not.toContain("--> statement-breakpoint");
    expect(sql).not.toContain("CREATE TABLE `credit_card`");
    expect(sql).toContain("PREPARE pp_incremental_statement FROM @pp_sql");
    expect(sql).toContain("SHA2(@pp_candidate_sql, 256)");
    expect(sql).toContain("TABLE_NAME = 'credit_card') = 0");
    expect(sql).toContain("TABLE_NAME = 'expense') = 0");
    expect(sql).toContain("TABLE_NAME = 'credit_card_installment') = 0");
    expect(manifest.targetObjects).toContainEqual({
      name: "credit_card",
      tableName: "credit_card",
      type: "create-table",
    });
    expect(manifest.boundary).toContain("not transactional");
    expect(manifest.boundary).toContain("not rerunnable");
  });

  it.each([
    "",
    "0000_platform_migration_verification",
    "0011_missing",
    "../../0006_receivables",
  ])("rejects an invalid incremental selection: %s", async (migrationTag) => {
    await expect(
      buildPhpMyAdminIncrementalMigrationBundle({
        migrationTag,
        outputDirectory: await temporaryOutputDirectory(),
        projectRoot,
        serverVersionSha256,
        targetDatabaseSha256,
      }),
    ).rejects.toThrow();
  });

  it("accepts only the exact 0011 additive column, composite FK, unique index, and legacy index removal shapes", () => {
    expect(
      analyzeIncrementalMigrationStatement(
        "ALTER TABLE `consulting_contract` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin",
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      columnName: "project_id",
      nullable: true,
      tableName: "consulting_contract",
      type: "add-column",
    });
    expect(
      analyzeIncrementalMigrationStatement(
        "ALTER TABLE `receivable` ADD COLUMN `project_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin",
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      columnName: "project_id",
      tableName: "receivable",
      type: "add-column",
    });
    expect(
      analyzeIncrementalMigrationStatement(
        "ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_customer_project` FOREIGN KEY (`customer_id`,`project_id`) REFERENCES `customer_project`(`customer_id`,`project_id`) ON DELETE restrict ON UPDATE restrict",
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      columnNames: ["customer_id", "project_id"],
      referencedColumnNames: ["customer_id", "project_id"],
      type: "foreign-key",
    });
    expect(
      analyzeIncrementalMigrationStatement(
        "CREATE UNIQUE INDEX `uq_consulting_contract_customer_project_start` ON `consulting_contract` (`customer_id`,`project_id`,`starts_on`)",
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      columnNames: ["customer_id", "project_id", "starts_on"],
      type: "create-index",
      unique: true,
    });
    expect(
      analyzeIncrementalMigrationStatement(
        "DROP INDEX `uq_consulting_contract_customer_start` ON `consulting_contract`",
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      columnNames: ["customer_id", "starts_on"],
      type: "drop-index",
      unique: true,
    });

    for (const invalid of [
      "ALTER TABLE `consulting_contract` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      "ALTER TABLE `customer` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin",
      "ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_customer_project` FOREIGN KEY (`project_id`,`customer_id`) REFERENCES `customer_project`(`project_id`,`customer_id`) ON DELETE restrict ON UPDATE restrict",
      "DROP INDEX `uq_receivable_contract_month` ON `receivable`",
      "DROP TABLE `customer`",
    ]) {
      expect(() =>
        analyzeIncrementalMigrationStatement(
          invalid,
          customerProjectsPartnershipMigrationTag,
        ),
      ).toThrow();
    }
  });

  it("allows only the exact 0011 data backfills, including legacy task-to-project pairs", () => {
    expect(
      analyzeIncrementalMigrationStatement(
        customerProjectBackfill,
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      backfillKind: "customer-project-muhendis-kafasi",
      type: "data-backfill",
    });
    expect(
      analyzeIncrementalMigrationStatement(
        consultingContractBackfill,
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      backfillKind: "consulting-contract-muhendis-kafasi",
      type: "data-backfill",
    });
    expect(
      analyzeIncrementalMigrationStatement(
        receivableBackfill,
        customerProjectsPartnershipMigrationTag,
      ),
    ).toMatchObject({
      backfillKind: "receivable-contract-or-muhendis-kafasi",
      type: "data-backfill",
    });

    expect(() =>
      analyzeIncrementalMigrationStatement(
        `${consultingContractBackfill} AND 1 = 1`,
        customerProjectsPartnershipMigrationTag,
      ),
    ).toThrow();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        "DELETE FROM `customer_project`",
        customerProjectsPartnershipMigrationTag,
      ),
    ).toThrow();
    expect(() =>
      analyzeIncrementalMigrationStatement(
        customerProjectBackfill,
        "0012_future",
      ),
    ).toThrow();
  });

  it("emits per-statement guards with exact column order, uniqueness, MK preflight, and data postflights", async () => {
    const migrationSql = [
      "ALTER TABLE `consulting_contract` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin",
      "ALTER TABLE `receivable` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin",
      customerProjectBackfill,
      consultingContractBackfill,
      receivableBackfill,
      "DROP INDEX `uq_consulting_contract_customer_start` ON `consulting_contract`",
      "CREATE UNIQUE INDEX `uq_consulting_contract_customer_project_start` ON `consulting_contract` (`customer_id`,`project_id`,`starts_on`)",
      "ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_customer_project` FOREIGN KEY (`customer_id`,`project_id`) REFERENCES `customer_project`(`customer_id`,`project_id`) ON DELETE restrict ON UPDATE restrict",
    ].join(";\n--> statement-breakpoint\n");
    const { manifest, sql } = await buildFixture(migrationSql);

    expect(manifest.targetObjects).toContainEqual({
      name: "project_id",
      tableName: "consulting_contract",
      type: "add-column",
    });
    expect(manifest.targetObjects).toContainEqual({
      name: "backfill_customer_project_muhendis_kafasi",
      tableName: "customer_project",
      type: "data-backfill",
    });
    expect(manifest.targetObjects).toContainEqual({
      name: "uq_consulting_contract_customer_start",
      tableName: "consulting_contract",
      type: "drop-index",
    });
    expect(sql).toContain("BINARY `short_code` = BINARY 'MUHENDIS_KAFASI') = 1");
    expect(sql).toContain("wt.`customer_id` IS NOT NULL AND cp.`customer_id` IS NULL");
    expect(sql).toContain("FROM `receivable` WHERE `project_id` IS NULL) = 0");
    expect(sql).toContain("SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'customer_id'");
    expect(sql).toContain("SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'project_id'");
    expect(sql).toContain("SEQ_IN_INDEX = 3 AND COLUMN_NAME = 'starts_on'");
    expect(sql).toContain("NON_UNIQUE = 0");
    expect(sql).toContain("ORDINAL_POSITION = 1 AND POSITION_IN_UNIQUE_CONSTRAINT = 1 AND COLUMN_NAME = 'customer_id'");
    expect(sql).toContain("ORDINAL_POSITION = 2 AND POSITION_IN_UNIQUE_CONSTRAINT = 2 AND COLUMN_NAME = 'project_id'");

    const initialGuard = sql.slice(
      0,
      sql.indexOf("SET @pp_candidate_sql = 0x"),
    );
    expect(initialGuard).toContain("COLUMN_NAME = 'project_id') = 0");
    expect(initialGuard).not.toContain(
      "TABLE_NAME = 'consulting_contract' AND COLUMN_NAME = 'project_id') = 1",
    );
    expect(initialGuard).not.toContain(
      "TABLE_NAME = 'receivable' AND COLUMN_NAME = 'project_id') = 1",
    );
    expect(candidateStatements(sql)).toEqual([
      ...migrationSql
        .split(/;\s*--> statement-breakpoint\s*/gu)
        .map((statement) => statement.trim().replace(/;$/u, "")),
      expect.stringContaining("INSERT INTO `__drizzle_migrations`"),
    ]);
  });
});
