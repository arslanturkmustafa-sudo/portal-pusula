import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error The local artifact builder is intentionally plain Node ESM.
import { buildPhpMyAdminMigrationBundle as untypedBuildBundle } from "../../scripts/build-phpmyadmin-migration-bundle.mjs";
// @ts-expect-error The shared migration contract is intentionally plain Node ESM.
import { migrationLockName as untypedMigrationLockName } from "../../scripts/migration-integrity.mjs";

const disposableMariaDbEnabled =
  process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const journalTable = "__drizzle_migrations";
const knownTablesInDropOrder = [
  "work_task",
  "user_account",
  "receivable_collection",
  "receivable",
  "monthly_visit_commitment",
  "consulting_contract",
  "customer",
  "cron_dispatch_gate",
  "job_run",
  "scheduled_job",
  "outbox_event",
  "audit_event",
  "_platform_migration_verification",
  journalTable,
  "phpmyadmin_bundle_nonempty_sentinel",
  "phpmyadmin_bundle_poison",
] as const;

interface BundleSummary {
  manifestPath: string;
  sqlPath: string;
}

interface BundleManifest {
  formatVersion: number;
  sessionPolicy: {
    characterSet: string;
    collation: string;
    modifiesGlobalSqlMode: boolean;
    restoresOriginalSqlMode: boolean;
    sqlMode: string;
    storageEngine: string;
    timeZone: string;
  };
}

interface DatabaseRow extends RowDataPacket {
  database_name: string;
  server_version: string;
}

interface SqlModeRow extends RowDataPacket {
  global_sql_mode: string;
  session_sql_mode: string;
}

interface JournalRow extends RowDataPacket {
  created_at: number;
  hash: string;
  id: number;
}

interface LockRow extends RowDataPacket {
  acquired: number | null;
  connection_id: number | null;
  free: number | null;
  owner: number | null;
  released: number | null;
}

interface QueryOutcome {
  errors: number;
  firstErrorIndex?: number;
  results: string[];
}

interface ExecutionHooks {
  afterStatementError?: (
    statement: string,
    statementIndex: number,
  ) => Promise<void>;
  beforeStatement?: (
    statement: string,
    statementIndex: number,
  ) => Promise<void>;
  destroyOnAbort?: boolean;
}

const buildBundle = untypedBuildBundle as (options: {
  outputDirectory: string;
  projectRoot: string;
  serverVersionSha256: string;
  targetDatabaseSha256: string;
}) => Promise<BundleSummary>;
const migrationLockName = untypedMigrationLockName as (
  databaseName: string,
) => string;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!disposableMariaDbEnabled || typeof value !== "string" || value === "") {
    throw new Error("Disposable MariaDB test environment is incomplete.");
  }
  return value;
}

function migrationEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DB_HOST: requiredEnvironment("DB_HOST"),
    DB_NAME: requiredEnvironment("DB_NAME"),
    DB_PASSWORD: requiredEnvironment("DB_PASSWORD"),
    DB_PORT: requiredEnvironment("DB_PORT"),
    DB_USER: requiredEnvironment("DB_USER"),
    NODE_ENV: "test",
  };
}

function runMigration(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("scripts", "migrate.mjs")], {
      cwd: repositoryRoot,
      env: migrationEnvironment(),
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => reject(new Error("Migration runner failed.")));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Migration runner failed."));
    });
  });
}

function executableStatements(sql: string): string[] {
  const statements = sql
    .split(/\r?\n/u)
    .filter((line) => line !== "" && !line.startsWith("--"));
  if (statements.some((statement) => !statement.endsWith(";"))) {
    throw new Error("Generated phpMyAdmin bundle is not line-delimited SQL.");
  }
  return statements.map((statement) => statement.slice(0, -1));
}

async function executeBundleOnConnection(
  connection: PoolConnection,
  sql: string,
  mode: "abort-on-first-error" | "continue-on-error",
  hooks: ExecutionHooks = {},
): Promise<QueryOutcome & { destroyed: boolean }> {
  let errors = 0;
  let firstErrorIndex: number | undefined;
  const results: string[] = [];
  let destroyed = false;

  for (const [statementIndex, statement] of executableStatements(sql).entries()) {
    await hooks.beforeStatement?.(statement, statementIndex);
    try {
      const [rows] = await connection.query<RowDataPacket[]>(statement);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const result = row.portal_pusula_migration_bundle_result;
          if (typeof result === "string") results.push(result);
        }
      }
    } catch (error) {
      errors += 1;
      firstErrorIndex ??= statementIndex;
      await hooks.afterStatementError?.(statement, statementIndex);
      if (process.env.PORTAL_PUSULA_BUNDLE_DEBUG === "1") {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN";
        console.error(`Bundle statement ${statementIndex} failed: ${code}`);
      }
      if (mode === "abort-on-first-error") {
        if (hooks.destroyOnAbort !== false) {
          connection.destroy();
          destroyed = true;
        }
        break;
      }
    }
  }

  return { destroyed, errors, firstErrorIndex, results };
}

async function executeBundle(
  pool: Pool,
  sql: string,
  mode: "abort-on-first-error" | "continue-on-error",
  hooks: ExecutionHooks = {},
): Promise<QueryOutcome> {
  const connection = await pool.getConnection();
  let destroyed = false;
  try {
    const outcome = await executeBundleOnConnection(connection, sql, mode, hooks);
    destroyed = outcome.destroyed;
    return {
      errors: outcome.errors,
      firstErrorIndex: outcome.firstErrorIndex,
      results: outcome.results,
    };
  } finally {
    if (!destroyed) connection.release();
  }
}

async function resetKnownTables(pool: Pool) {
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.query("SET SESSION foreign_key_checks = 0");
    try {
      for (const tableName of knownTablesInDropOrder) {
        await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      }
    } finally {
      await connection.query("SET SESSION foreign_key_checks = 1");
    }
  } catch (error) {
    reusable = false;
    connection.destroy();
    throw error;
  } finally {
    if (reusable) connection.release();
  }
}

async function tableNames(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<(RowDataPacket & { TABLE_NAME: string })[]>(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY BINARY TABLE_NAME`,
  );
  return rows.map((row) => row.TABLE_NAME);
}

async function journalRows(pool: Pool): Promise<JournalRow[]> {
  const [rows] = await pool.query<JournalRow[]>(
    `SELECT id, hash, created_at FROM \`${journalTable}\` ORDER BY id`,
  );
  return rows.map((row) => ({
    created_at: Number(row.created_at),
    hash: row.hash,
    id: Number(row.id),
  })) as JournalRow[];
}

async function assertRunnerLockAvailable(pool: Pool, databaseName: string) {
  const lockName = migrationLockName(databaseName);
  const connection = await pool.getConnection();
  try {
    const [acquiredRows] = await connection.query<LockRow[]>(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [lockName],
    );
    expect(Number(acquiredRows[0]?.acquired)).toBe(1);
    const [releasedRows] = await connection.query<LockRow[]>(
      "SELECT RELEASE_LOCK(?) AS released",
      [lockName],
    );
    expect(Number(releasedRows[0]?.released)).toBe(1);
  } finally {
    connection.release();
  }
}

async function schemaDefinitionSnapshot(
  pool: Pool,
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const tableName of await tableNames(pool)) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SHOW CREATE TABLE \`${tableName}\``,
    );
    const definition = rows[0]?.["Create Table"];
    if (typeof definition !== "string") {
      throw new Error("Could not read canonical table definition.");
    }
    snapshot[tableName] = definition;
  }
  return snapshot;
}

function jobRunCandidateExecuteIndex(sql: string): number {
  const prefix = Buffer.from("CREATE TABLE `job_run`", "utf8").toString("hex");
  const statements = executableStatements(sql);
  const candidateIndex = statements.findIndex((statement) =>
    statement.startsWith(`SET @pp_candidate_sql = 0x${prefix}`),
  );
  if (candidateIndex < 0) throw new Error("Could not locate job_run candidate SQL.");
  return candidateIndex + 5;
}

function corruptJobRunCandidate(sql: string): string {
  const prefix = Buffer.from("CREATE TABLE `job_run`", "utf8").toString("hex");
  const linePattern = new RegExp(
    `^SET @pp_candidate_sql = 0x(${prefix}[0-9a-f]*);$`,
    "mu",
  );
  const match = linePattern.exec(sql);
  if (!match) throw new Error("Could not locate job_run candidate SQL.");
  const candidate = match[1];
  const replacement = `${candidate.slice(0, -1)}${candidate.endsWith("0") ? "1" : "0"}`;
  return sql.replace(match[0], `SET @pp_candidate_sql = 0x${replacement};`);
}

describe.skipIf(!disposableMariaDbEnabled).sequential(
  "clean-only phpMyAdmin migration bundle on real MariaDB",
  () => {
    let pool: Pool;
    let outputDirectory = "";
    let databaseName = "";
    let validManifest: BundleManifest;
    let validSql = "";

    beforeAll(async () => {
      pool = mysql.createPool({
        charset: "utf8mb4",
        connectionLimit: 4,
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
      await resetKnownTables(pool);
      const [databaseRows] = await pool.query<DatabaseRow[]>(
        "SELECT DATABASE() AS database_name, VERSION() AS server_version",
      );
      databaseName = databaseRows[0]?.database_name ?? "";
      const serverVersion = databaseRows[0]?.server_version ?? "";
      outputDirectory = await mkdtemp(
        path.resolve(tmpdir(), "portal-pusula-phpmyadmin-it-"),
      );
      const summary = await buildBundle({
        outputDirectory,
        projectRoot: repositoryRoot,
        serverVersionSha256: createHash("sha256")
          .update(serverVersion, "utf8")
          .digest("hex"),
        targetDatabaseSha256: createHash("sha256")
          .update(databaseName, "utf8")
          .digest("hex"),
      });
      validSql = await readFile(
        path.resolve(repositoryRoot, summary.sqlPath),
        "utf8",
      );
      validManifest = JSON.parse(
        await readFile(
          path.resolve(repositoryRoot, summary.manifestPath),
          "utf8",
        ),
      ) as BundleManifest;
    });

    afterAll(async () => {
      try {
        if (pool) await resetKnownTables(pool);
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

    it("publishes an exact format-2 session policy without changing global SQL mode", () => {
      expect(validManifest).toMatchObject({
        formatVersion: 2,
        sessionPolicy: {
          characterSet: "utf8mb4",
          collation: "utf8mb4_unicode_ci",
          modifiesGlobalSqlMode: false,
          restoresOriginalSqlMode: true,
          sqlMode:
            "STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION",
          storageEngine: "InnoDB",
          timeZone: "+00:00",
        },
      });
      expect(validSql).toContain("-- Format 2;");
      expect(validSql).toContain("SET @pp_original_sql_mode = @@SESSION.sql_mode;");
      expect(validSql).toContain(
        "SET @@SESSION.sql_mode = COALESCE(@pp_original_sql_mode, @@SESSION.sql_mode), @pp_session_restore_applied = 1;",
      );
      expect(validSql).not.toContain("SET GLOBAL");
      expect(validSql).not.toContain("@@GLOBAL.sql_mode");
    });

    it("temporarily enforces strict mode on a non-strict provider session and restores it", async () => {
      await resetKnownTables(pool);
      const connection = await pool.getConnection();
      let reusable = true;
      try {
        await connection.query(
          "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'",
        );
        const [beforeRows] = await connection.query<SqlModeRow[]>(
          `SELECT
             @@GLOBAL.sql_mode AS global_sql_mode,
             @@SESSION.sql_mode AS session_sql_mode`,
        );
        const before = beforeRows[0];
        expect(before).toBeDefined();
        expect(before?.global_sql_mode).not.toMatch(/STRICT_(?:ALL|TRANS)_TABLES/u);
        expect(before?.session_sql_mode).not.toMatch(/STRICT_(?:ALL|TRANS)_TABLES/u);

        const outcome = await executeBundleOnConnection(
          connection,
          validSql,
          "continue-on-error",
          { destroyOnAbort: false },
        );
        reusable = !outcome.destroyed;

        const [afterRows] = await connection.query<SqlModeRow[]>(
          `SELECT
             @@GLOBAL.sql_mode AS global_sql_mode,
             @@SESSION.sql_mode AS session_sql_mode`,
        );
        expect({
          globalUnchanged:
            afterRows[0]?.global_sql_mode === before?.global_sql_mode,
          outcome: {
            errors: outcome.errors,
            results: outcome.results,
          },
          sessionRestored:
            afterRows[0]?.session_sql_mode === before?.session_sql_mode,
        }).toEqual({
          globalUnchanged: true,
          outcome: {
            errors: 0,
            results: ["PORTAL_PUSULA_MIGRATION_BUNDLE_OK"],
          },
          sessionRestored: true,
        });
        expect(await tableNames(pool)).toHaveLength(14);
        expect(await journalRows(pool)).toHaveLength(9);
      } catch (error) {
        reusable = false;
        throw error;
      } finally {
        if (reusable) connection.release();
        else connection.destroy();
      }
    }, 45_000);

    it.each(["abort-on-first-error", "continue-on-error"] as const)(
      "fails closed before DDL when the strict-mode SET is rejected in %s mode",
      async (mode) => {
        await resetKnownTables(pool);
        const invalidPolicySql = validSql.replace(
          /^SET @@SESSION\.sql_mode = .*@pp_session_policy_applied = 1;$/mu,
          "SET @@SESSION.sql_mode = 'PORTAL_PUSULA_INVALID_SQL_MODE', @pp_session_policy_applied = 1;",
        );
        expect(invalidPolicySql).not.toBe(validSql);

        const outcome = await executeBundle(pool, invalidPolicySql, mode);

        expect(outcome.errors).toBeGreaterThanOrEqual(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([]);
        await assertRunnerLockAvailable(pool, databaseName);
      },
      20_000,
    );

    it.each(["abort-on-first-error", "continue-on-error"] as const)(
      "fails closed before DDL when strict session readback drifts in %s mode",
      async (mode) => {
        await resetKnownTables(pool);
        const connection = await pool.getConnection();
        let driftInjected = false;
        try {
          await connection.query(
            "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'",
          );
          const outcome = await executeBundleOnConnection(
            connection,
            validSql,
            mode,
            {
              beforeStatement: async (statement) => {
                if (
                  !driftInjected &&
                  statement.startsWith(
                    "SET @pp_step = IF(@pp_original_sql_mode IS NOT NULL",
                  )
                ) {
                  await connection.query(
                    "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'",
                  );
                  driftInjected = true;
                }
              },
              destroyOnAbort: false,
            },
          );
          const [modeRows] = await connection.query<SqlModeRow[]>(
            `SELECT
               @@GLOBAL.sql_mode AS global_sql_mode,
               @@SESSION.sql_mode AS session_sql_mode`,
          );

          expect(driftInjected).toBe(true);
          expect(outcome.errors).toBeGreaterThanOrEqual(1);
          expect(outcome.results).toEqual([]);
          expect(await tableNames(pool)).toEqual([]);
          expect(modeRows[0]?.global_sql_mode).not.toMatch(
            /STRICT_(?:ALL|TRANS)_TABLES/u,
          );
          expect(modeRows[0]?.session_sql_mode).toBe(
            "NO_ENGINE_SUBSTITUTION",
          );
          await assertRunnerLockAvailable(pool, databaseName);
        } finally {
          connection.destroy();
        }
      },
      30_000,
    );

    it("stops all later DDL and journal writes after mid-import session drift", async () => {
      await resetKnownTables(pool);
      const connection = await pool.getConnection();
      const executeIndex = jobRunCandidateExecuteIndex(validSql);
      let driftInjected = false;
      try {
        await connection.query(
          "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'",
        );
        const outcome = await executeBundleOnConnection(
          connection,
          validSql,
          "continue-on-error",
          {
            beforeStatement: async (_statement, statementIndex) => {
              if (!driftInjected && statementIndex === executeIndex - 4) {
                await connection.query(
                  "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'",
                );
                driftInjected = true;
              }
            },
            destroyOnAbort: false,
          },
        );
        const [modeRows] = await connection.query<SqlModeRow[]>(
          `SELECT
             @@GLOBAL.sql_mode AS global_sql_mode,
             @@SESSION.sql_mode AS session_sql_mode`,
        );

        expect(driftInjected).toBe(true);
        expect(outcome.errors).toBeGreaterThanOrEqual(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([
          "__drizzle_migrations",
          "_platform_migration_verification",
          "audit_event",
        ]);
        expect(await journalRows(pool)).toHaveLength(1);
        expect(modeRows[0]?.global_sql_mode).not.toMatch(
          /STRICT_(?:ALL|TRANS)_TABLES/u,
        );
        expect(modeRows[0]?.session_sql_mode).toBe(
          "NO_ENGINE_SUBSTITUTION",
        );
        await assertRunnerLockAvailable(pool, databaseName);
      } finally {
        connection.destroy();
      }
    }, 30_000);

    it("applies a clean bundle, writes an exact journal, and remains runner-compatible", async () => {
      await resetKnownTables(pool);
      const outcome = await executeBundle(
        pool,
        validSql,
        "abort-on-first-error",
      );

      const tablesAfter = await tableNames(pool);
      const journalAfter = tablesAfter.includes(journalTable)
        ? await journalRows(pool)
        : [];
      const [diagnostics] = await pool.query<RowDataPacket[]>(
        `SELECT
          (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '${journalTable}' AND ENGINE = 'InnoDB' AND TABLE_COLLATION = 'utf8mb4_unicode_ci') AS matching_application_tables,
          (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${journalTable}' AND ENGINE = 'InnoDB' AND TABLE_COLLATION LIKE 'utf8mb4\\_%') AS matching_journal_tables,
          (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '${journalTable}') AS application_columns,
          (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK') AS checks,
          (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY') AS foreign_keys,
          (SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()) AS indexes,
          @@SESSION.sql_mode AS sql_mode`,
      );
      expect({
        diagnostics: diagnostics[0],
        journalCount: journalAfter.length,
        outcome,
        tablesAfter,
      }).toEqual({
        diagnostics: {
          application_columns: 134,
          checks: 58,
          foreign_keys: 8,
          indexes: 44,
          matching_application_tables: 13,
          matching_journal_tables: 1,
          sql_mode: expect.any(String),
        },
        outcome: {
          errors: 0,
          firstErrorIndex: undefined,
          results: ["PORTAL_PUSULA_MIGRATION_BUNDLE_OK"],
        },
        tablesAfter: [
          "__drizzle_migrations",
          "_platform_migration_verification",
          "audit_event",
          "consulting_contract",
          "cron_dispatch_gate",
          "customer",
          "job_run",
          "monthly_visit_commitment",
          "outbox_event",
          "receivable",
          "receivable_collection",
          "scheduled_job",
          "user_account",
          "work_task",
        ],
        journalCount: 9,
      });

      await expect(
        pool.query(
          `INSERT INTO \`audit_event\`
             (\`id\`, \`actor_type\`, \`action\`, \`entity_type\`, \`entity_id\`, \`before_summary\`, \`correlation_id\`, \`occurred_at_utc\`)
           VALUES
             (UUID(), 'system', 'probe', 'probe', UUID(), 'not-json', 'bundle-json-check', UTC_TIMESTAMP(6))`,
        ),
      ).rejects.toBeDefined();

      const bundleSchema = await schemaDefinitionSnapshot(pool);
      await expect(runMigration()).resolves.toBeUndefined();
      expect(await journalRows(pool)).toHaveLength(9);
      expect(await schemaDefinitionSnapshot(pool)).toEqual(bundleSchema);

      await resetKnownTables(pool);
      await expect(runMigration()).resolves.toBeUndefined();
      expect(await schemaDefinitionSnapshot(pool)).toEqual(bundleSchema);
    }, 45_000);

    it("rejects a second import in both phpMyAdmin error modes without changing state", async () => {
      const tablesBefore = await tableNames(pool);
      const journalBefore = await journalRows(pool);

      const abortOutcome = await executeBundle(
        pool,
        validSql,
        "abort-on-first-error",
      );
      expect(abortOutcome.errors).toBe(1);
      expect(abortOutcome.results).toEqual([]);
      await assertRunnerLockAvailable(pool, databaseName);
      expect(await tableNames(pool)).toEqual(tablesBefore);
      expect(await journalRows(pool)).toEqual(journalBefore);

      const continueOutcome = await executeBundle(
        pool,
        validSql,
        "continue-on-error",
      );
      expect(continueOutcome.errors).toBeGreaterThan(1);
      expect(continueOutcome.results).toEqual([]);
      await assertRunnerLockAvailable(pool, databaseName);
      expect(await tableNames(pool)).toEqual(tablesBefore);
      expect(await journalRows(pool)).toEqual(journalBefore);
    }, 20_000);

    it("rejects a wrong target digest on an empty database and releases its lock on abort", async () => {
      await resetKnownTables(pool);
      const wrongDirectory = await mkdtemp(
        path.resolve(tmpdir(), "portal-pusula-phpmyadmin-wrong-"),
      );
      try {
        const [versionRows] = await pool.query<DatabaseRow[]>(
          "SELECT VERSION() AS server_version, DATABASE() AS database_name",
        );
        const summary = await buildBundle({
          outputDirectory: wrongDirectory,
          projectRoot: repositoryRoot,
          serverVersionSha256: createHash("sha256")
            .update(versionRows[0]?.server_version ?? "", "utf8")
            .digest("hex"),
          targetDatabaseSha256: "0".repeat(64),
        });
        const wrongSql = await readFile(
          path.resolve(repositoryRoot, summary.sqlPath),
          "utf8",
        );
        const outcome = await executeBundle(
          pool,
          wrongSql,
          "abort-on-first-error",
        );
        expect(outcome.errors).toBe(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([]);
        await assertRunnerLockAvailable(pool, databaseName);
      } finally {
        await rm(wrongDirectory, { force: true, recursive: true });
      }
    });

    it("rejects a wrong server-version digest without mutating an empty target", async () => {
      await resetKnownTables(pool);
      const wrongDirectory = await mkdtemp(
        path.resolve(tmpdir(), "portal-pusula-phpmyadmin-wrong-version-"),
      );
      try {
        const summary = await buildBundle({
          outputDirectory: wrongDirectory,
          projectRoot: repositoryRoot,
          serverVersionSha256: "0".repeat(64),
          targetDatabaseSha256: createHash("sha256")
            .update(databaseName, "utf8")
            .digest("hex"),
        });
        const wrongSql = await readFile(
          path.resolve(repositoryRoot, summary.sqlPath),
          "utf8",
        );
        const outcome = await executeBundle(
          pool,
          wrongSql,
          "continue-on-error",
        );

        expect(outcome.errors).toBeGreaterThanOrEqual(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([]);
        await assertRunnerLockAvailable(pool, databaseName);
      } finally {
        await rm(wrongDirectory, { force: true, recursive: true });
      }
    });

    it("does not take or bypass the migration lock held by another connection", async () => {
      await resetKnownTables(pool);
      const lockName = migrationLockName(databaseName);
      const holder = await pool.getConnection();
      try {
        const [connectionRows] = await holder.query<LockRow[]>(
          "SELECT CONNECTION_ID() AS connection_id",
        );
        const holderId = Number(connectionRows[0]?.connection_id);
        const [acquiredRows] = await holder.query<LockRow[]>(
          "SELECT GET_LOCK(?, 0) AS acquired",
          [lockName],
        );
        expect(Number(acquiredRows[0]?.acquired)).toBe(1);

        const outcome = await executeBundle(
          pool,
          validSql,
          "continue-on-error",
        );
        expect(outcome.errors).toBeGreaterThanOrEqual(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([]);

        const [ownerRows] = await holder.query<LockRow[]>(
          "SELECT IS_USED_LOCK(?) AS owner",
          [lockName],
        );
        expect(Number(ownerRows[0]?.owner)).toBe(holderId);
        const [releasedRows] = await holder.query<LockRow[]>(
          "SELECT RELEASE_LOCK(?) AS released",
          [lockName],
        );
        expect(Number(releasedRows[0]?.released)).toBe(1);
        const [freeRows] = await holder.query<LockRow[]>(
          "SELECT IS_FREE_LOCK(?) AS free",
          [lockName],
        );
        expect(Number(freeRows[0]?.free)).toBe(1);
      } finally {
        holder.destroy();
      }
    }, 40_000);

    it("rejects stale same-session state without recursively taking or releasing its existing lock", async () => {
      await resetKnownTables(pool);
      const lockName = migrationLockName(databaseName);
      const connection = await pool.getConnection();
      try {
        await connection.query(
          "SET @pp_bundle_id = 'poison', @pp_target_database_sha256 = 'poison', @pp_server_version_sha256 = 'poison', @pp_lock_name = 'poison', @pp_lock_was_already_owned = 0, @pp_lock_acquired = 1, @pp_release_result = 1, @pp_candidate_sql = 'poison', @pp_sql = 'poison', @pp_step = 999",
        );
        await connection.query(
          "PREPARE pp_bundle_statement FROM 'CREATE TABLE `phpmyadmin_bundle_poison` (`id` INT NOT NULL PRIMARY KEY)'",
        );
        const [connectionRows] = await connection.query<LockRow[]>(
          "SELECT CONNECTION_ID() AS connection_id",
        );
        const connectionId = Number(connectionRows[0]?.connection_id);
        const [acquiredRows] = await connection.query<LockRow[]>(
          "SELECT GET_LOCK(?, 0) AS acquired",
          [lockName],
        );
        expect(Number(acquiredRows[0]?.acquired)).toBe(1);

        const outcome = await executeBundleOnConnection(
          connection,
          validSql,
          "continue-on-error",
          { destroyOnAbort: false },
        );
        expect(outcome.errors).toBeGreaterThanOrEqual(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([]);

        const [ownerRows] = await connection.query<LockRow[]>(
          "SELECT IS_USED_LOCK(?) AS owner",
          [lockName],
        );
        expect(Number(ownerRows[0]?.owner)).toBe(connectionId);
        const [releasedRows] = await connection.query<LockRow[]>(
          "SELECT RELEASE_LOCK(?) AS released",
          [lockName],
        );
        expect(Number(releasedRows[0]?.released)).toBe(1);
        const [freeRows] = await connection.query<LockRow[]>(
          "SELECT IS_FREE_LOCK(?) AS free",
          [lockName],
        );
        expect(Number(freeRows[0]?.free)).toBe(1);
      } finally {
        connection.destroy();
      }
    }, 20_000);

    it("rejects a nonempty target even when the importer continues after errors", async () => {
      await resetKnownTables(pool);
      await pool.query(
        "CREATE TABLE `phpmyadmin_bundle_nonempty_sentinel` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
      );
      const outcome = await executeBundle(
        pool,
        validSql,
        "continue-on-error",
      );
      expect(outcome.errors).toBeGreaterThan(1);
      expect(outcome.results).toEqual([]);
      expect(await tableNames(pool)).toEqual([
        "phpmyadmin_bundle_nonempty_sentinel",
      ]);
      await assertRunnerLockAvailable(pool, databaseName);
    });

    it.each(["abort-on-first-error", "continue-on-error"] as const)(
      "does not apply later DDL or a false journal row after a corrupted step in %s mode",
      async (mode) => {
        await resetKnownTables(pool);
        const outcome = await executeBundle(
          pool,
          corruptJobRunCandidate(validSql),
          mode,
        );

        expect(outcome.errors).toBeGreaterThanOrEqual(1);
        expect(outcome.results).toEqual([]);
        expect(await tableNames(pool)).toEqual([
          "__drizzle_migrations",
          "_platform_migration_verification",
          "audit_event",
        ]);
        expect(await journalRows(pool)).toHaveLength(1);
        await assertRunnerLockAvailable(pool, databaseName);
      },
      20_000,
    );

    it.each(["abort-on-first-error", "continue-on-error"] as const)(
      "stops later DDL and journal writes after a real EXECUTE-time DDL error in %s mode",
      async (mode) => {
        await resetKnownTables(pool);
        const blocker = await pool.getConnection();
        const executeIndex = jobRunCandidateExecuteIndex(validSql);
        let blockerTableExists = false;
        try {
          const outcome = await executeBundle(pool, validSql, mode, {
            afterStatementError: async (_statement, statementIndex) => {
              if (statementIndex === executeIndex && blockerTableExists) {
                await blocker.query("DROP TABLE `job_run`");
                blockerTableExists = false;
              }
            },
            beforeStatement: async (_statement, statementIndex) => {
              if (statementIndex === executeIndex) {
                await blocker.query(
                  "CREATE TABLE `job_run` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
                );
                blockerTableExists = true;
              }
            },
          });

          expect(outcome.errors).toBeGreaterThanOrEqual(1);
          expect(outcome.firstErrorIndex).toBe(executeIndex);
          expect(outcome.results).toEqual([]);
          expect(await tableNames(pool)).toEqual([
            "__drizzle_migrations",
            "_platform_migration_verification",
            "audit_event",
          ]);
          expect(await journalRows(pool)).toHaveLength(1);
          await assertRunnerLockAvailable(pool, databaseName);
        } finally {
          try {
            if (blockerTableExists) {
              await blocker.query("DROP TABLE IF EXISTS `job_run`");
            }
          } finally {
            blocker.destroy();
          }
        }
      },
      30_000,
    );
  },
);
