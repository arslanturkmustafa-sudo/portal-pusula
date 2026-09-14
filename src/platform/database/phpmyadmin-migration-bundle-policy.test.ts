import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The local artifact builder is intentionally plain Node ESM.
import * as untypedBundleModule from "../../../scripts/build-phpmyadmin-migration-bundle.mjs";

const {
  analyzeMigrationStatement: untypedAnalyzeMigrationStatement,
  buildPhpMyAdminMigrationBundle: untypedBuildPhpMyAdminMigrationBundle,
} = untypedBundleModule;

interface BundleSummary {
  bundleId: string;
  manifestPath: string;
  migrationCount: number;
  sqlBytes: number;
  sqlPath: string;
  sqlSha256: string;
  serverVersionSha256: string;
  statementCount: number;
  targetDatabaseSha256: string;
}

interface BundleManifest {
  boundary: string;
  bundleId: string;
  formatVersion: number;
  migrations: Array<{
    createdAt: number;
    hash: string;
    sqlFileName: string;
    statementHashes: string[];
  }>;
  minimumMariaDb: string;
  schema: {
    checks: Array<{ name: string; tableName: string }>;
    foreignKeys: Array<{ name: string; tableName: string }>;
    indexes: Array<{ name: string; tableName: string }>;
    jsonChecks: Array<{ columnName: string; tableName: string }>;
    tables: Record<string, string[]>;
  };
  sqlBytes: number;
  sqlSha256: string;
  serverVersionSha256: string;
  targetDatabaseSha256: string;
}

const buildPhpMyAdminMigrationBundle =
  untypedBuildPhpMyAdminMigrationBundle as (options: {
    outputDirectory: string;
    projectRoot: string;
    targetDatabaseSha256: string;
    serverVersionSha256: string;
  }) => Promise<BundleSummary>;
const analyzeMigrationStatement = untypedAnalyzeMigrationStatement as (
  statement: string,
) => unknown;

const projectRoot = process.cwd();
const targetDatabaseNameFixture =
  "fixture_database_name_that_must_not_reach_artifacts";
const targetDatabaseSha256 = createHash("sha256")
  .update(targetDatabaseNameFixture, "utf8")
  .digest("hex");
const serverVersionFixture = "11.4.8-MariaDB-test-fixture";
const serverVersionSha256 = createHash("sha256")
  .update(serverVersionFixture, "utf8")
  .digest("hex");
const outputDirectories: string[] = [];

async function temporaryOutputDirectory() {
  const directory = await mkdtemp(
    resolve(tmpdir(), "portal-pusula-phpmyadmin-bundle-"),
  );
  outputDirectories.push(directory);
  return directory;
}

async function build(outputDirectory: string) {
  const summary = await buildPhpMyAdminMigrationBundle({
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
    manifest: JSON.parse(manifestText) as BundleManifest,
    manifestText,
    sql,
    summary,
  };
}

afterEach(async () => {
  await Promise.all(
    outputDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe.sequential("clean-only phpMyAdmin migration bundle policy", () => {
  it("builds byte-identical SQL and manifest artifacts", async () => {
    const outputDirectory = await temporaryOutputDirectory();
    const first = await build(outputDirectory);
    const second = await build(outputDirectory);

    expect(second.summary).toEqual(first.summary);
    expect(second.sql).toBe(first.sql);
    expect(second.manifestText).toBe(first.manifestText);
    expect(first.summary.migrationCount).toBe(25);
    expect(first.summary.statementCount).toBe(247);
    expect(first.summary.sqlBytes).toBe(Buffer.byteLength(first.sql));
    expect(first.summary.sqlSha256).toBe(
      createHash("sha256").update(first.sql).digest("hex"),
    );
    expect(first.manifest.sqlSha256).toBe(first.summary.sqlSha256);
    expect(first.manifest.bundleId).toBe(first.summary.bundleId);
  });

  it("binds only the target digest and never serializes the database name", async () => {
    const artifact = await build(await temporaryOutputDirectory());

    expect(artifact.sql).not.toContain(targetDatabaseNameFixture);
    expect(artifact.manifestText).not.toContain(targetDatabaseNameFixture);
    expect(artifact.sql).not.toContain(serverVersionFixture);
    expect(artifact.manifestText).not.toContain(serverVersionFixture);
    expect(artifact.sql).toContain(targetDatabaseSha256);
    expect(artifact.sql).toContain(serverVersionSha256);
    expect(artifact.manifest.targetDatabaseSha256).toBe(
      targetDatabaseSha256,
    );
    expect(artifact.sql).toContain("SHA2(DATABASE(), 256)");
    expect(artifact.sql).toContain(
      "CONCAT('pp:migrate:', LEFT(SHA2(DATABASE(), 256), 48))",
    );
  });

  it("contains no routine, delimiter, trigger, dynamic identifier, or plaintext migration SQL", async () => {
    const { sql } = await build(await temporaryOutputDirectory());

    expect(sql).not.toMatch(/\b(?:DELIMITER|PROCEDURE|FUNCTION|TRIGGER)\b/iu);
    expect(sql).not.toContain("CREATE TABLE `scheduled_job`");
    expect(sql).toContain("PREPARE pp_bundle_statement FROM @pp_sql");
    expect(sql).toContain(
      Buffer.from("PORTAL_PUSULA_BUNDLE_GUARD_FAILURE", "utf8").toString(
        "hex",
      ),
    );
    const executableLines = sql
      .split(/\r?\n/u)
      .filter((line) => line !== "" && !line.startsWith("--"));
    expect(executableLines.every((line) => line.endsWith(";"))).toBe(true);
  });

  it("records the complete expected schema contract in the manifest", async () => {
    const { manifest, sql } = await build(await temporaryOutputDirectory());

    expect(Object.keys(manifest.schema.tables)).toEqual([
      "_platform_migration_verification",
      "audit_event",
      "consulting_contract",
      "credit_card",
      "credit_card_installment",
      "credit_card_installment_payment",
      "cron_dispatch_gate",
      "customer",
      "customer_project",
      "expense",
      "expense_category",
      "finance_account",
      "finance_ledger_entry",
      "finance_transaction",
      "job_run",
      "login_attempt_throttle",
      "monthly_visit_commitment",
      "outbox_event",
      "partnership_commission",
      "partnership_contribution",
      "partnership_contribution_receipt",
      "project",
      "receivable",
      "receivable_collection",
      "recurring_expense",
      "scheduled_job",
      "tax_obligation",
      "user_account",
      "user_notification_setting",
      "user_permission",
      "work_task",
      "work_task_project",
      "work_task_visit",
    ]);
    expect(manifest.schema.tables.scheduled_job).toContain("lease_token");
    expect(manifest.schema.tables.consulting_contract).toContain("project_id");
    expect(manifest.schema.tables.consulting_contract).toEqual(
      expect.arrayContaining([
        "archive_reason",
        "archived_at_utc",
        "archived_by_user_account_id",
        "version",
      ]),
    );
    expect(manifest.schema.tables.customer).toEqual(
      expect.arrayContaining([
        "archive_reason",
        "archived_at_utc",
        "archived_by_user_account_id",
        "version",
      ]),
    );
    expect(manifest.schema.tables.receivable).toContain("project_id");
    expect(manifest.schema.tables.receivable).toEqual(
      expect.arrayContaining([
        "record_state",
        "void_reason",
        "voided_at_utc",
        "version",
      ]),
    );
    expect(manifest.schema.tables.receivable_collection).toEqual(
      expect.arrayContaining([
        "entry_type",
        "finance_transaction_id",
        "reversal_of_id",
        "reversal_reason",
      ]),
    );
    expect(manifest.schema.tables.credit_card_installment).toContain(
      "finance_transaction_id",
    );
    expect(manifest.schema.tables.credit_card_installment_payment).toEqual([
      "id",
      "client_operation_key",
      "installment_id",
      "finance_transaction_id",
      "amount",
      "paid_on",
      "entry_type",
      "reversal_of_id",
      "reversal_reason",
      "created_at_utc",
    ]);
    expect(manifest.schema.tables.expense_category).toEqual(
      expect.arrayContaining(["code", "display_name", "status"]),
    );
    expect(manifest.schema.tables.monthly_visit_commitment).toContain(
      "location_label",
    );
    expect(manifest.schema.tables.recurring_expense).toEqual(
      expect.arrayContaining([
        "category",
        "frequency",
        "next_due_on",
        "status",
        "total_amount",
      ]),
    );
    expect(manifest.schema.tables.work_task).toEqual(
      expect.arrayContaining([
        "recurrence_frequency",
        "recurrence_anchor_day",
        "recurrence_ends_on",
        "recurrence_series_id",
        "recurrence_generated_from_task_id",
      ]),
    );
    expect(manifest.schema.tables.user_account).toEqual(
      expect.arrayContaining(["display_name", "role"]),
    );
    expect(manifest.schema.tables.user_permission).toEqual([
      "user_account_id",
      "permission_code",
      "created_at_utc",
    ]);
    expect(manifest.schema.tables.login_attempt_throttle).toEqual([
      "bucket_key",
      "bucket_type",
      "failure_count",
      "window_started_at_utc",
      "blocked_until_utc",
      "updated_at_utc",
    ]);
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_scheduled_job_lease_shape",
      tableName: "scheduled_job",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_login_attempt_throttle_state",
      tableName: "login_attempt_throttle",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_customer_archive",
      tableName: "customer",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_receivable_collection_entry",
      tableName: "receivable_collection",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_recurring_expense_schedule",
      tableName: "recurring_expense",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_work_task_recurrence",
      tableName: "work_task",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_credit_card_installment_finance_transaction",
      tableName: "credit_card_installment",
    });
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_receivable_collection_finance_transaction_identity",
      tableName: "receivable_collection",
    });
    expect(manifest.schema.checks).toEqual(
      expect.arrayContaining([
        {
          name: "chk_credit_card_installment_payment_identity",
          tableName: "credit_card_installment_payment",
        },
        {
          name: "chk_credit_card_installment_payment_amount",
          tableName: "credit_card_installment_payment",
        },
        {
          name: "chk_credit_card_installment_payment_entry",
          tableName: "credit_card_installment_payment",
        },
      ]),
    );
    expect(manifest.schema.foreignKeys).toEqual([
      {
        name: "fk_consulting_contract_archived_by",
        tableName: "consulting_contract",
      },
      {
        name: "fk_consulting_contract_customer",
        tableName: "consulting_contract",
      },
      {
        name: "fk_consulting_contract_customer_project",
        tableName: "consulting_contract",
      },
      {
        name: "fk_credit_card_installment_payment_installment",
        tableName: "credit_card_installment_payment",
      },
      {
        name: "fk_credit_card_installment_payment_reversal",
        tableName: "credit_card_installment_payment",
      },
      {
        name: "fk_credit_card_installment_payment_transaction",
        tableName: "credit_card_installment_payment",
      },
      {
        name: "fk_credit_card_installment_expense",
        tableName: "credit_card_installment",
      },
      {
        name: "fk_credit_card_installment_finance_transaction",
        tableName: "credit_card_installment",
      },
      {
        name: "fk_customer_project_customer",
        tableName: "customer_project",
      },
      {
        name: "fk_customer_project_project",
        tableName: "customer_project",
      },
      {
        name: "fk_customer_archived_by",
        tableName: "customer",
      },
      {
        name: "fk_expense_category",
        tableName: "expense",
      },
      {
        name: "fk_expense_credit_card",
        tableName: "expense",
      },
      {
        name: "fk_expense_finance_transaction",
        tableName: "expense",
      },
      {
        name: "fk_expense_project",
        tableName: "expense",
      },
      {
        name: "fk_expense_source_account",
        tableName: "expense",
      },
      {
        name: "fk_finance_ledger_entry_account",
        tableName: "finance_ledger_entry",
      },
      {
        name: "fk_finance_ledger_entry_transaction",
        tableName: "finance_ledger_entry",
      },
      {
        name: "fk_finance_transaction_reversal",
        tableName: "finance_transaction",
      },
      {
        name: "fk_finance_transaction_source_account",
        tableName: "finance_transaction",
      },
      {
        name: "fk_finance_transaction_target_account",
        tableName: "finance_transaction",
      },
      {
        name: "fk_job_run_scheduled_job",
        tableName: "job_run",
      },
      {
        name: "fk_monthly_visit_contract",
        tableName: "monthly_visit_commitment",
      },
      {
        name: "fk_partnership_commission_project",
        tableName: "partnership_commission",
      },
      {
        name: "fk_partnership_contribution_receipt_contribution",
        tableName: "partnership_contribution_receipt",
      },
      {
        name: "fk_partnership_contribution_receipt_reversal",
        tableName: "partnership_contribution_receipt",
      },
      {
        name: "fk_partnership_contribution_project",
        tableName: "partnership_contribution",
      },
      {
        name: "fk_project_archived_by",
        tableName: "project",
      },
      {
        name: "fk_receivable_collection_finance_transaction",
        tableName: "receivable_collection",
      },
      {
        name: "fk_receivable_collection_receivable",
        tableName: "receivable_collection",
      },
      {
        name: "fk_receivable_collection_reversal",
        tableName: "receivable_collection",
      },
      {
        name: "fk_receivable_contract",
        tableName: "receivable",
      },
      {
        name: "fk_receivable_customer",
        tableName: "receivable",
      },
      {
        name: "fk_receivable_customer_project",
        tableName: "receivable",
      },
      {
        name: "fk_recurring_expense_category",
        tableName: "recurring_expense",
      },
      {
        name: "fk_recurring_expense_credit_card",
        tableName: "recurring_expense",
      },
      {
        name: "fk_recurring_expense_project",
        tableName: "recurring_expense",
      },
      {
        name: "fk_recurring_expense_source_account",
        tableName: "recurring_expense",
      },
      {
        name: "fk_user_notification_setting_account",
        tableName: "user_notification_setting",
      },
      {
        name: "fk_user_permission_account",
        tableName: "user_permission",
      },
      {
        name: "fk_work_task_project_project",
        tableName: "work_task_project",
      },
      {
        name: "fk_work_task_project_task",
        tableName: "work_task_project",
      },
      {
        name: "fk_work_task_visit_task",
        tableName: "work_task_visit",
      },
      {
        name: "fk_work_task_visit_visit",
        tableName: "work_task_visit",
      },
      {
        name: "fk_work_task_archived_by",
        tableName: "work_task",
      },
      {
        name: "fk_work_task_assignee",
        tableName: "work_task",
      },
      {
        name: "fk_work_task_customer",
        tableName: "work_task",
      },
      {
        name: "fk_work_task_recurrence_source",
        tableName: "work_task",
      },
    ]);
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_platform_migration_verification_idempotency",
      tableName: "_platform_migration_verification",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_consulting_contract_customer_project_start",
      tableName: "consulting_contract",
    });
    expect(manifest.schema.indexes).not.toContainEqual({
      name: "uq_consulting_contract_customer_start",
      tableName: "consulting_contract",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_partnership_contribution_receipt_operation",
      tableName: "partnership_contribution_receipt",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "idx_login_attempt_throttle_updated",
      tableName: "login_attempt_throttle",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_receivable_collection_reversal",
      tableName: "receivable_collection",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_receivable_collection_finance_transaction",
      tableName: "receivable_collection",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_credit_card_installment_finance_transaction",
      tableName: "credit_card_installment",
    });
    expect(manifest.schema.indexes).toEqual(
      expect.arrayContaining([
        {
          name: "idx_credit_card_installment_payment_installment_date",
          tableName: "credit_card_installment_payment",
        },
        {
          name: "uq_credit_card_installment_payment_operation",
          tableName: "credit_card_installment_payment",
        },
        {
          name: "uq_credit_card_installment_payment_reversal",
          tableName: "credit_card_installment_payment",
        },
        {
          name: "uq_credit_card_installment_payment_transaction",
          tableName: "credit_card_installment_payment",
        },
      ]),
    );
    expect(manifest.schema.indexes).toContainEqual({
      name: "idx_receivable_state_due",
      tableName: "receivable",
    });
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_expense_category_display_name",
      tableName: "expense_category",
    });
    expect(manifest.schema.indexes).toEqual(
      expect.arrayContaining([
        {
          name: "idx_recurring_expense_status_due",
          tableName: "recurring_expense",
        },
        {
          name: "idx_recurring_expense_project_due",
          tableName: "recurring_expense",
        },
        {
          name: "uq_recurring_expense_client_operation",
          tableName: "recurring_expense",
        },
        {
          name: "uq_work_task_recurrence_source",
          tableName: "work_task",
        },
        {
          name: "idx_work_task_recurrence_series",
          tableName: "work_task",
        },
      ]),
    );
    expect(sql).toContain(
      "BINARY TABLE_NAME = BINARY 'expense_category' AND BINARY INDEX_NAME = BINARY 'uq_expense_category_display_name'",
    );
    expect(sql).not.toContain("AND INDEX_NAME IN (");
    expect(manifest.schema.jsonChecks).toEqual([
      { columnName: "after_summary", tableName: "audit_event" },
      { columnName: "before_summary", tableName: "audit_event" },
      { columnName: "payload", tableName: "outbox_event" },
      { columnName: "payload", tableName: "scheduled_job" },
    ]);
    expect(
      manifest.migrations.map((migration) => ({
        createdAt: migration.createdAt,
        hash: migration.hash,
        sqlFileName: migration.sqlFileName,
        statementCount: migration.statementHashes.length,
      })),
    ).toEqual([
      {
        createdAt: 1788107612321,
        hash: "3fdcdcd582fc0c2002948f6f3d5b1993b117bccc5fb2581714e932c0575a65a8",
        sqlFileName: "0000_platform_migration_verification.sql",
        statementCount: 1,
      },
      {
        createdAt: 1788112845060,
        hash: "a113ac3d3d40cb4017d7a8a9406f4cc4d568e274f22d2d4e5577e11fd4635cce",
        sqlFileName: "0001_platform_job_outbox_audit.sql",
        statementCount: 13,
      },
      {
        createdAt: 1788116023820,
        hash: "b2a4f6a5c53f9e48b300467045c03f9e602f58a0ab33572dc315fff173b2952c",
        sqlFileName: "0002_platform_state_constraints.sql",
        statementCount: 12,
      },
      {
        createdAt: 1788117573101,
        hash: "42b92645038c4f436b0ea88c544f0859ef016f8e04e4c10f3b547ec0cf6e51bd",
        sqlFileName: "0003_platform_cron_dispatch_gate.sql",
        statementCount: 1,
      },
      {
        createdAt: 1788262397356,
        hash: "8027aef0d0c48a6c29d806a45c7e074a50ea7cf890dc1a40786c0f3b63bf0dc5",
        sqlFileName: "0004_customer.sql",
        statementCount: 2,
      },
      {
        createdAt: 1788265670001,
        hash: "33b7926be1645c3367dd5c8a7db79ee7aea78391331d457dc694624e68264a4b",
        sqlFileName: "0005_consulting_contract_visits.sql",
        statementCount: 6,
      },
      {
        createdAt: 1788282029501,
        hash: "5e559147a2b664853f48dcac08e520c5d976eadc3f6ee98b383bbc397a9dfb91",
        sqlFileName: "0006_receivables.sql",
        statementCount: 8,
      },
      {
        createdAt: 1788288108173,
        hash: "4ec9220ec18d7766ccb52535586082a6a6bcb69f9b0ceed1aa4d8f3344adb380",
        sqlFileName: "0007_user_account.sql",
        statementCount: 1,
      },
      {
        createdAt: 1788352666114,
        hash: "9835a13facbd1a0485bcc4cb6e6776e0f2d64b9b1d1c59aa0798fa97dbb21aa3",
        sqlFileName: "0008_work_tasks.sql",
        statementCount: 6,
      },
      {
        createdAt: 1788423447345,
        hash: "86e1b6730d77d1e5d70ed011a0073926a1704b14940fa22c12bce94ae9b3d8f2",
        sqlFileName: "0009_projects.sql",
        statementCount: 7,
      },
      {
        createdAt: 1788428596372,
        hash: "1a2d0d64e14138d940fa2d6f4e56561b16ad06c7a63b1be6e63d6073c0c0c629",
        sqlFileName: "0010_expenses_cards.sql",
        statementCount: 12,
      },
      {
        createdAt: 1788435178955,
        hash: "b3abd1340be3a5f4c96c1a63348d44c134bdc907fc5a24e1b978093ad6708c81",
        sqlFileName: "0011_customer_projects_partnership.sql",
        statementCount: 25,
      },
      {
        createdAt: 1788457473182,
        hash: "31e4ab2e12ae6596a042c912c32ea3e90e96f8160e670530ae00adca3d0c7872",
        sqlFileName: "0012_user_permissions.sql",
        statementCount: 7,
      },
      {
        createdAt: 1788504772177,
        hash: "587449c0221adfc447216d95c3ee453d32a19457a93ae3f71e0d7f91b73f3d67",
        sqlFileName: "0013_login_attempt_throttle.sql",
        statementCount: 3,
      },
      {
        createdAt: 1788512254928,
        hash: "616db5f1f8c62efce707f98febdf5a2d325f8fa8791811429aa20b374f96aba4",
        sqlFileName: "0014_record_lifecycle.sql",
        statementCount: 44,
      },
      {
        createdAt: 1788512602613,
        hash: "cce0b24f60ec8a30ec99b985aa079c2de2e1d5dbcd60b1c1507f0794f3ec71be",
        sqlFileName: "0015_financial_reversals.sql",
        statementCount: 26,
      },
      {
        createdAt: 1788765657335,
        hash: "5b92bb29683ae3e6981938cd79ceb5e48addb3d85e7b32a4e56dafd124890153",
        sqlFileName: "0016_finance_accounts_ledger.sql",
        statementCount: 15,
      },
      {
        createdAt: 1788765868726,
        hash: "bb1241676016ea62f65944607393f09d76bef6f0c53630bfa9d61c203818d7e8",
        sqlFileName: "0017_work_task_visit.sql",
        statementCount: 4,
      },
      {
        createdAt: 1788799557949,
        hash: "48286e594051f082b85891e043f9578dfa2105fb50aef98b878e8d476cdbba6f",
        sqlFileName: "0018_planning_expense_categories.sql",
        statementCount: 9,
      },
      {
        createdAt: 1788832085941,
        hash: "9c200e015a6565f6cdc681fab1dfebefc5015759fa75ef1f9862d7e7a1a01abe",
        sqlFileName: "0019_tax_obligations.sql",
        statementCount: 4,
      },
      {
        createdAt: 1788938626518,
        hash: "a95bed1c3e8f65d71a5063423ceefbfc676678c03699e2d89d098f1b31811226",
        sqlFileName: "0020_expense_account_ledger.sql",
        statementCount: 8,
      },
      {
        createdAt: 1788995986876,
        hash: "435b28ee71f0ab1a267d012c040569cefe8610935bdaf8586f6ddfb1367c6ef7",
        sqlFileName: "0021_user_notification_settings.sql",
        statementCount: 2,
      },
      {
        createdAt: 1789060097371,
        hash: "9aca25ba6a18ee00a0cedb32f8e5a6ea22b2dfdb813302b9a87bffc3f03cbf5f",
        sqlFileName: "0022_recurring_tasks_expenses.sql",
        statementCount: 17,
      },
      {
        createdAt: 1789195799696,
        hash: "e4a5e27b1b6113baa0bafcc52b29c7d1e8a78a293ee326daf5eb086b48bed5e3",
        sqlFileName: "0023_collection_card_accounts.sql",
        statementCount: 8,
      },
      {
        createdAt: 1789383073515,
        hash: "e9dd804de1525319cc1da6fed05d4d4c69afa776dde4cda99457cfcdab6d1bf5",
        sqlFileName: "0024_partial_card_payments.sql",
        statementCount: 6,
      },
    ]);
    expect(
      manifest.migrations.flatMap((migration) => migration.statementHashes),
    ).toHaveLength(247);
    expect(
      manifest.migrations
        .flatMap((migration) => migration.statementHashes)
        .every((hash) => /^[0-9a-f]{64}$/u.test(hash)),
    ).toBe(true);
    expect(manifest.boundary).toContain("Clean-only");
    expect(manifest.boundary).toContain("not a rollback or backup artifact");
  });

  it.each(["", "ABC", "g".repeat(64), "0".repeat(63), "0".repeat(65)])(
    "rejects invalid target digest %j",
    async (invalidDigest) => {
      await expect(
        buildPhpMyAdminMigrationBundle({
          outputDirectory: await temporaryOutputDirectory(),
          projectRoot,
          serverVersionSha256,
          targetDatabaseSha256: invalidDigest,
        }),
      ).rejects.toThrow("PHPMYADMIN_TARGET_DB_SHA256 is missing or invalid.");
    },
  );

  it.each(["", "ABC", "g".repeat(64), "0".repeat(63), "0".repeat(65)])(
    "rejects invalid server-version digest %j",
    async (invalidDigest) => {
      await expect(
        buildPhpMyAdminMigrationBundle({
          outputDirectory: await temporaryOutputDirectory(),
          projectRoot,
          serverVersionSha256: invalidDigest,
          targetDatabaseSha256,
        }),
      ).rejects.toThrow(
        "PHPMYADMIN_SERVER_VERSION_SHA256 is missing or invalid.",
      );
    },
  );

  it.each([
    "DROP TABLE `scheduled_job`",
    "TRUNCATE TABLE `scheduled_job`",
    "UPDATE `scheduled_job` SET `status` = 'pending'",
    "CREATE TABLE `safe_name` (`id` INT); DROP TABLE `safe_name`",
    "CREATE TABLE `safe_name` (`id` INT) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci AS SELECT 1 AS `id`",
    "ALTER TABLE `safe_name` ADD CONSTRAINT `chk_safe_name` CHECK (`id` > 0), DROP COLUMN `id`",
    "CREATE INDEX `idx_unsafe` ON `safe_name` (`id`, LOWER(`id`))",
    "CREATE TRIGGER unsafe BEFORE INSERT ON `scheduled_job` FOR EACH ROW SET @x=1",
    "SELECT 1",
  ])("rejects unsupported or destructive SQL: %s", (statement) => {
    expect(() => analyzeMigrationStatement(statement)).toThrow(
      "phpMyAdmin migration bundle generation failed.",
    );
  });

  it("accepts the restricted foreign-key DDL without treating ON DELETE/UPDATE as DML", () => {
    expect(() =>
      analyzeMigrationStatement(
        "ALTER TABLE `job_run` ADD CONSTRAINT `fk_job_run_scheduled_job` FOREIGN KEY (`job_id`) REFERENCES `scheduled_job`(`id`) ON DELETE restrict ON UPDATE restrict",
      ),
    ).not.toThrow();
  });

  it("accepts a semicolon only when it is inside a table comment literal", () => {
    expect(() =>
      analyzeMigrationStatement(
        "CREATE TABLE `safe_name` (\n  `id` INT NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Safe; literal-only comment'",
      ),
    ).not.toThrow();
  });
});
