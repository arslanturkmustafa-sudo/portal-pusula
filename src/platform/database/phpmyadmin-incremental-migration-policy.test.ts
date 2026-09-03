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
