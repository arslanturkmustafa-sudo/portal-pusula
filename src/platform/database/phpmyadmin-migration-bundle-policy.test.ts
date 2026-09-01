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
    expect(first.summary.migrationCount).toBe(5);
    expect(first.summary.statementCount).toBe(29);
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
    const { manifest } = await build(await temporaryOutputDirectory());

    expect(Object.keys(manifest.schema.tables)).toEqual([
      "_platform_migration_verification",
      "audit_event",
      "cron_dispatch_gate",
      "customer",
      "job_run",
      "outbox_event",
      "scheduled_job",
    ]);
    expect(manifest.schema.tables.scheduled_job).toContain("lease_token");
    expect(manifest.schema.checks).toContainEqual({
      name: "chk_scheduled_job_lease_shape",
      tableName: "scheduled_job",
    });
    expect(manifest.schema.foreignKeys).toEqual([
      {
        name: "fk_job_run_scheduled_job",
        tableName: "job_run",
      },
    ]);
    expect(manifest.schema.indexes).toContainEqual({
      name: "uq_platform_migration_verification_idempotency",
      tableName: "_platform_migration_verification",
    });
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
    ]);
    expect(
      manifest.migrations.flatMap((migration) => migration.statementHashes),
    ).toHaveLength(29);
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
