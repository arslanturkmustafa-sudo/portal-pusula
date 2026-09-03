import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The deployment artifact builder is intentionally plain Node ESM.
import * as untypedModule from "../../../scripts/build-phpmyadmin-incremental-migration.mjs";

const { buildPhpMyAdminIncrementalMigrationBundle: untypedBuild } =
  untypedModule;

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

async function build(outputDirectory: string) {
  const summary = await buildPhpMyAdminIncrementalMigrationBundle({
    migrationTag: "0009_projects",
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
  it("builds a deterministic, target-bound 0009 artifact", async () => {
    const outputDirectory = await temporaryOutputDirectory();
    const first = await build(outputDirectory);
    const second = await build(outputDirectory);

    expect(second).toEqual(first);
    expect(first.summary.statementCount).toBe(7);
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

  it("requires the exact previous journal and records the selected hash", async () => {
    const { manifest, sql } = await build(await temporaryOutputDirectory());

    expect(manifest.expectedJournalCount).toBe(9);
    expect(manifest.expectedPreviousMigration.tag).toBe(
      "0008_work_tasks",
    );
    expect(manifest.migration.tag).toBe("0009_projects");
    expect(manifest.migration.statementHashes).toHaveLength(7);
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
    expect(sql).not.toContain("CREATE TABLE `project`");
    expect(sql).toContain("PREPARE pp_incremental_statement FROM @pp_sql");
    expect(sql).toContain("SHA2(@pp_candidate_sql, 256)");
    expect(sql).toContain("TABLE_NAME = 'project') = 0");
    expect(sql).toContain("TABLE_NAME = 'work_task_project') = 0");
    expect(manifest.targetObjects).toContainEqual({
      name: "project",
      tableName: "project",
      type: "create-table",
    });
    expect(manifest.boundary).toContain("not transactional");
    expect(manifest.boundary).toContain("not rerunnable");
  });

  it.each([
    "",
    "0000_platform_migration_verification",
    "0010_missing",
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
});
