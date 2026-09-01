import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeMigrationStatement } from "./build-phpmyadmin-migration-bundle.mjs";
import {
  assertExpectedMigrationsUnchanged,
  DRIZZLE_MIGRATIONS_TABLE,
  MIGRATION_LOCK_DIGEST_HEX_LENGTH,
  MIGRATION_LOCK_PREFIX,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  readExpectedMigrations,
} from "./migration-integrity.mjs";
import {
  MYSQL_SESSION_CHARACTER_SET,
  MYSQL_SESSION_COLLATION,
  MYSQL_SESSION_SQL_MODE,
  MYSQL_SESSION_STORAGE_ENGINE,
  MYSQL_SESSION_TIME_ZONE,
} from "./mysql-session-policy.mjs";

const FORMAT_VERSION = 1;
const JOURNAL_TABLE = DRIZZLE_MIGRATIONS_TABLE;
const GUARD_FAILURE_QUERY =
  "PORTAL_PUSULA_INCREMENTAL_MIGRATION_GUARD_FAILURE";
const SAFE_NOOP_QUERY = "SELECT 1 WHERE 0";
const migrationBreakpoint = /--> statement-breakpoint\s*/gu;
const migrationTagPattern = /^[0-9]{4}_[A-Za-z0-9][A-Za-z0-9_-]*$/u;

const defaultProjectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class PhpMyAdminIncrementalBundleError extends Error {
  constructor(message = "phpMyAdmin incremental migration bundle generation failed.") {
    super(message);
    this.name = "PhpMyAdminIncrementalBundleError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlHex(value) {
  return `0x${Buffer.from(value, "utf8").toString("hex")}`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlStringList(values) {
  return values.map(sqlString).join(", ");
}

function validateDigest(value, variableName) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new PhpMyAdminIncrementalBundleError(
      `${variableName} is missing or invalid.`,
    );
  }
}

function validateMigrationTag(value) {
  if (typeof value !== "string" || !migrationTagPattern.test(value)) {
    throw new PhpMyAdminIncrementalBundleError(
      "PHPMYADMIN_INCREMENTAL_MIGRATION_TAG is missing or invalid.",
    );
  }
}

function splitMigrationSql(sql) {
  const segments = sql.split(migrationBreakpoint);
  if (segments.some((segment) => segment.trim().length === 0)) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  const statements = segments.map((statement) =>
    statement.trim().replace(/;\s*$/u, "").trim(),
  );
  if (statements.length === 0) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  return statements;
}

function mysqlSessionPolicyPredicate() {
  return [
    `BINARY @@SESSION.sql_mode = BINARY ${sqlString(MYSQL_SESSION_SQL_MODE)}`,
    `BINARY @@SESSION.time_zone = BINARY ${sqlString(MYSQL_SESSION_TIME_ZONE)}`,
    `BINARY @@SESSION.character_set_client = BINARY ${sqlString(MYSQL_SESSION_CHARACTER_SET)}`,
    `BINARY @@SESSION.character_set_connection = BINARY ${sqlString(MYSQL_SESSION_CHARACTER_SET)}`,
    `BINARY @@SESSION.character_set_results = BINARY ${sqlString(MYSQL_SESSION_CHARACTER_SET)}`,
    `BINARY @@SESSION.collation_connection = BINARY ${sqlString(MYSQL_SESSION_COLLATION)}`,
    `BINARY @@SESSION.default_storage_engine = BINARY ${sqlString(MYSQL_SESSION_STORAGE_ENGINE)}`,
    "@@SESSION.autocommit = 1",
    "@@SESSION.check_constraint_checks = 1",
    "@@SESSION.foreign_key_checks = 1",
    "@@SESSION.unique_checks = 1",
  ].join(" AND ");
}

function journalStructurePredicate() {
  return `(SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(JOURNAL_TABLE)}
               AND TABLE_TYPE = 'BASE TABLE'
               AND ENGINE = 'InnoDB') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(JOURNAL_TABLE)}) = 3
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(JOURNAL_TABLE)}
                   AND COLUMN_NAME IN ('id', 'hash', 'created_at')) = 3
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(JOURNAL_TABLE)}
                   AND INDEX_NAME = 'PRIMARY'
                   AND NON_UNIQUE = 0
                   AND SEQ_IN_INDEX = 1
                   AND COLUMN_NAME = 'id') = 1`;
}

function constraintPredicate(tableName, constraintName, constraintType) {
  return `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(tableName)}
               AND CONSTRAINT_NAME = ${sqlString(constraintName)}
               AND CONSTRAINT_TYPE = ${sqlString(constraintType)}) = 1`;
}

function statementVerificationPredicate(analysis) {
  if (analysis.type === "create-table") {
    const constraints = analysis.constraintNames.map((constraint) => {
      const type =
        constraint.type === "UNIQUE"
          ? "UNIQUE"
          : constraint.type === "CHECK"
            ? "CHECK"
            : constraint.type === "FOREIGN KEY"
              ? "FOREIGN KEY"
              : "PRIMARY KEY";
      return constraintPredicate(analysis.tableName, constraint.name, type);
    });
    return [
      `(SELECT COUNT(*) FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND TABLE_TYPE = 'BASE TABLE'
            AND ENGINE = 'InnoDB'
            AND TABLE_COLLATION = 'utf8mb4_unicode_ci') = 1`,
      `(SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}) = ${analysis.columnNames.length}`,
      `(SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND COLUMN_NAME IN (${sqlStringList(analysis.columnNames)})) = ${analysis.columnNames.length}`,
      ...constraints,
    ].join(" AND ");
  }

  if (analysis.type === "check") {
    return constraintPredicate(
      analysis.tableName,
      analysis.constraintName,
      "CHECK",
    );
  }

  if (analysis.type === "foreign-key") {
    return [
      constraintPredicate(
        analysis.tableName,
        analysis.constraintName,
        "FOREIGN KEY",
      ),
      `(SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
            AND COLUMN_NAME = ${sqlString(analysis.columnName)}
            AND REFERENCED_TABLE_NAME = ${sqlString(analysis.referencedTableName)}
            AND REFERENCED_COLUMN_NAME = ${sqlString(analysis.referencedColumnName)}) = 1`,
      `(SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
            AND UPDATE_RULE = 'RESTRICT'
            AND DELETE_RULE = 'RESTRICT') = 1`,
    ].join(" AND ");
  }

  return `(SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(analysis.tableName)}
               AND INDEX_NAME = ${sqlString(analysis.indexName)}) = 1
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(analysis.tableName)}
                   AND INDEX_NAME = ${sqlString(analysis.indexName)}) = ${analysis.columnNames.length}
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(analysis.tableName)}
                   AND INDEX_NAME = ${sqlString(analysis.indexName)}
                   AND COLUMN_NAME IN (${sqlStringList(analysis.columnNames)})) = ${analysis.columnNames.length}`;
}

function statementAbsentPredicate(analysis) {
  if (analysis.type === "create-table") {
    return `(SELECT COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}) = 0`;
  }
  if (analysis.type === "create-index") {
    return `(SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND INDEX_NAME = ${sqlString(analysis.indexName)}) = 0`;
  }
  return `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(analysis.tableName)}
               AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}) = 0`;
}

function existingTablePredicate(tableName) {
  return `(SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(tableName)}
               AND TABLE_TYPE = 'BASE TABLE'
               AND ENGINE = 'InnoDB') = 1`;
}

function existingColumnPredicate(tableName, columnName) {
  return `(SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(tableName)}
               AND COLUMN_NAME = ${sqlString(columnName)}) = 1`;
}

function prerequisitePredicates(statements) {
  const createdTables = new Set(
    statements
      .filter((item) => item.analysis.type === "create-table")
      .map((item) => item.analysis.tableName),
  );
  const predicates = new Set();

  function requireTable(tableName) {
    if (!createdTables.has(tableName)) {
      predicates.add(existingTablePredicate(tableName));
    }
  }

  function requireColumn(tableName, columnName) {
    if (!createdTables.has(tableName)) {
      requireTable(tableName);
      predicates.add(existingColumnPredicate(tableName, columnName));
    }
  }

  for (const item of statements) {
    const { analysis, sql } = item;
    if (analysis.type === "foreign-key") {
      requireColumn(analysis.tableName, analysis.columnName);
      requireColumn(
        analysis.referencedTableName,
        analysis.referencedColumnName,
      );
    } else if (analysis.type === "create-index") {
      for (const columnName of analysis.columnNames) {
        requireColumn(analysis.tableName, columnName);
      }
    } else if (analysis.type === "check") {
      requireTable(analysis.tableName);
    }

    for (const match of sql.matchAll(
      /REFERENCES\s+`([^`]+)`\s*\(\s*`([^`]+)`\s*\)/giu,
    )) {
      requireColumn(match[1], match[2]);
    }
  }

  return [...predicates];
}

function exactJournalPrefixPredicate(prefix, target) {
  const predicates = [
    `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`) = ${prefix.length}`,
    `(SELECT COALESCE(MAX(id), 0) FROM \`${JOURNAL_TABLE}\`) = ${prefix.length}`,
    `(SELECT AUTO_INCREMENT FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${sqlString(JOURNAL_TABLE)}) = ${prefix.length + 1}`,
    `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`
        WHERE BINARY hash = BINARY ${sqlString(target.hash)}
           OR created_at = ${target.createdAt}) = 0`,
  ];

  for (const [index, migration] of prefix.entries()) {
    predicates.push(
      `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`
          WHERE id = ${index + 1}
            AND OCTET_LENGTH(hash) = 64
            AND BINARY hash = BINARY ${sqlString(migration.hash)}
            AND created_at = ${migration.createdAt}) = 1`,
    );
  }
  return predicates.join(" AND ");
}

function exactJournalPostflightPredicate(prefix, target) {
  const expected = [...prefix, target];
  return [
    `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`) = ${expected.length}`,
    `(SELECT COALESCE(MAX(id), 0) FROM \`${JOURNAL_TABLE}\`) = ${expected.length}`,
    `(SELECT AUTO_INCREMENT FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${sqlString(JOURNAL_TABLE)}) = ${expected.length + 1}`,
    ...expected.map(
      (migration, index) =>
        `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`
           WHERE id = ${index + 1}
             AND OCTET_LENGTH(hash) = 64
             AND BINARY hash = BINARY ${sqlString(migration.hash)}
             AND created_at = ${migration.createdAt}) = 1`,
    ),
  ].join(" AND ");
}

function guardedStatementLines({ statement, expectedStep, predicate }) {
  const candidateHash = sha256(statement);
  const sessionGuard = `@pp_session_policy_applied = 1 AND (${mysqlSessionPolicyPredicate()})`;
  return [
    `SET @pp_candidate_sql = ${sqlHex(statement)};`,
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionGuard}) AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}, ${expectedStep}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionGuard}) AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}, @pp_candidate_sql, ${sqlHex(SAFE_NOOP_QUERY)});`,
    "PREPARE pp_incremental_statement FROM @pp_sql;",
    "EXECUTE pp_incremental_statement;",
    "DEALLOCATE PREPARE pp_incremental_statement;",
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionGuard}) AND (${predicate}), ${expectedStep + 1}, -1);`,
  ];
}

function compactSql(lines) {
  return `${lines
    .map((line) =>
      line.startsWith("--") || line === ""
        ? line
        : line.replaceAll(/\s*\r?\n\s*/gu, " ").trim(),
    )
    .join("\n")}\n`;
}

function buildSql({
  bundleId,
  migration,
  prefix,
  previousMigration,
  serverVersionSha256,
  statements,
  targetDatabaseSha256,
}) {
  const absentPredicate = statements
    .map((item) => statementAbsentPredicate(item.analysis))
    .join(" AND ");
  const prerequisites = prerequisitePredicates(statements);
  const prefixCheckSql = `SET @pp_step = IF((${exactJournalPrefixPredicate(prefix, migration)}), 1, -1)`;
  const lines = [
    "-- Portal Pusula existing-schema phpMyAdmin incremental migration bundle.",
    `-- Format ${FORMAT_VERSION}; bundle ${bundleId}.`,
    `-- Selected migration: ${migration.tag}; expected previous migration: ${previousMigration.tag}.`,
    "-- Forward-only DDL is not transactional. Exact success output is mandatory.",
    "SET @pp_bundle_id = NULL;",
    "SET @pp_target_database_sha256 = NULL;",
    "SET @pp_server_version_sha256 = NULL;",
    "SET @pp_selected_tag = NULL;",
    "SET @pp_expected_previous_tag = NULL;",
    "SET @pp_lock_name = NULL;",
    "SET @pp_lock_was_already_owned = NULL;",
    "SET @pp_lock_acquired = NULL;",
    "SET @pp_release_result = NULL;",
    "SET @pp_original_sql_mode = NULL;",
    "SET @pp_session_policy_applied = 0;",
    "SET @pp_session_restore_applied = 0;",
    "SET @pp_session_mode_restored = NULL;",
    "SET @pp_candidate_sql = NULL;",
    "SET @pp_sql = NULL;",
    "SET @pp_step = NULL;",
    "SET @pp_original_sql_mode = @@SESSION.sql_mode;",
    `SET @@SESSION.sql_mode = ${sqlString(MYSQL_SESSION_SQL_MODE)},
      @@SESSION.character_set_client = ${sqlString(MYSQL_SESSION_CHARACTER_SET)},
      @@SESSION.character_set_connection = ${sqlString(MYSQL_SESSION_CHARACTER_SET)},
      @@SESSION.character_set_results = ${sqlString(MYSQL_SESSION_CHARACTER_SET)},
      @@SESSION.collation_connection = ${sqlString(MYSQL_SESSION_COLLATION)},
      @@SESSION.time_zone = ${sqlString(MYSQL_SESSION_TIME_ZONE)},
      @@SESSION.autocommit = 1,
      @@SESSION.check_constraint_checks = 1,
      @@SESSION.foreign_key_checks = 1,
      @@SESSION.unique_checks = 1,
      @@SESSION.default_storage_engine = ${sqlString(MYSQL_SESSION_STORAGE_ENGINE)},
      @pp_session_policy_applied = 1;`,
    `SET @pp_bundle_id = ${sqlString(bundleId)};`,
    `SET @pp_target_database_sha256 = ${sqlString(targetDatabaseSha256)};`,
    `SET @pp_server_version_sha256 = ${sqlString(serverVersionSha256)};`,
    `SET @pp_selected_tag = ${sqlString(migration.tag)};`,
    `SET @pp_expected_previous_tag = ${sqlString(previousMigration.tag)};`,
    `SET @pp_lock_name = CONCAT(${sqlString(MIGRATION_LOCK_PREFIX)}, LEFT(SHA2(DATABASE(), 256), ${MIGRATION_LOCK_DIGEST_HEX_LENGTH}));`,
    "SET @pp_lock_was_already_owned = COALESCE(IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID(), 0);",
    `SET @pp_step = IF(@pp_original_sql_mode IS NOT NULL AND @pp_session_policy_applied = 1 AND (${mysqlSessionPolicyPredicate()}), 0, -1);`,
    `SET @pp_lock_acquired = IF(@pp_step = 0 AND NOT @pp_lock_was_already_owned, GET_LOCK(@pp_lock_name, ${MIGRATION_LOCK_TIMEOUT_SECONDS}), 0);`,
    "SET @pp_step = IF(@pp_step = 0 AND @pp_lock_acquired = 1 AND NOT @pp_lock_was_already_owned, 0, -1);",
    `SET @pp_step = IF(
      @pp_step = 0
      AND DATABASE() IS NOT NULL
      AND SHA2(DATABASE(), 256) = @pp_target_database_sha256
      AND SHA2(VERSION(), 256) = @pp_server_version_sha256
      AND BINARY @pp_selected_tag = BINARY ${sqlString(migration.tag)}
      AND BINARY @pp_expected_previous_tag = BINARY ${sqlString(previousMigration.tag)}
      AND (${mysqlSessionPolicyPredicate()})
      AND @@GLOBAL.check_constraint_checks = 1
      AND @@GLOBAL.foreign_key_checks = 1
      AND @@GLOBAL.unique_checks = 1
      AND @@GLOBAL.default_storage_engine = 'InnoDB'
      AND (${journalStructurePredicate()})
      AND (${absentPredicate})
      ${prerequisites.length > 0 ? `AND (${prerequisites.join(" AND ")})` : ""},
      0,
      -1
    );`,
    `SET @pp_sql = IF(@pp_step = 0, ${sqlHex(prefixCheckSql)}, ${sqlHex("SET @pp_step = -1")});`,
    "PREPARE pp_incremental_statement FROM @pp_sql;",
    "EXECUTE pp_incremental_statement;",
    "DEALLOCATE PREPARE pp_incremental_statement;",
  ];

  let step = 1;
  for (const item of statements) {
    lines.push(
      ...guardedStatementLines({
        expectedStep: step,
        predicate: statementVerificationPredicate(item.analysis),
        statement: item.sql,
      }),
    );
    step += 1;
  }

  const targetId = prefix.length + 1;
  const journalInsert = `INSERT INTO \`${JOURNAL_TABLE}\` (\`hash\`, \`created_at\`)
    SELECT ${sqlString(migration.hash)}, ${migration.createdAt}
    WHERE NOT EXISTS (
      SELECT 1 FROM \`${JOURNAL_TABLE}\`
       WHERE id = ${targetId}
         AND BINARY hash = BINARY ${sqlString(migration.hash)}
         AND created_at = ${migration.createdAt}
    )`;
  lines.push(
    ...guardedStatementLines({
      expectedStep: step,
      predicate: exactJournalPostflightPredicate(prefix, migration),
      statement: journalInsert,
    }),
  );
  step += 1;

  const postflight = [
    `SHA2(DATABASE(), 256) = ${sqlString(targetDatabaseSha256)}`,
    `SHA2(VERSION(), 256) = ${sqlString(serverVersionSha256)}`,
    `(${mysqlSessionPolicyPredicate()})`,
    ...statements.map((item) =>
      `(${statementVerificationPredicate(item.analysis)})`,
    ),
    `(${exactJournalPostflightPredicate(prefix, migration)})`,
  ].join(" AND ");
  const successQuery = `SELECT 'PORTAL_PUSULA_INCREMENTAL_MIGRATION_OK' AS portal_pusula_incremental_result, ${sqlString(migration.tag)} AS migration_tag`;

  lines.push(
    `SET @pp_step = IF(@pp_step = ${step} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${postflight}), ${step + 1}, -1);`,
    "SET @pp_session_restore_applied = 0;",
    "SET @@SESSION.sql_mode = COALESCE(@pp_original_sql_mode, @@SESSION.sql_mode), @pp_session_restore_applied = 1;",
    "SET @pp_session_mode_restored = COALESCE(@pp_session_restore_applied = 1 AND BINARY @@SESSION.sql_mode = BINARY @pp_original_sql_mode, 0);",
    `SET @pp_step = IF(@pp_step = ${step + 1} AND @pp_session_mode_restored = 1 AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID(), ${step + 2}, -1);`,
    "SET @pp_release_result = IF(@pp_lock_acquired = 1 AND NOT @pp_lock_was_already_owned, RELEASE_LOCK(@pp_lock_name), 0);",
    `SET @pp_step = IF(@pp_step = ${step + 2} AND @pp_release_result = 1 AND COALESCE(IS_USED_LOCK(@pp_lock_name) <> CONNECTION_ID(), 1), ${step + 3}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(@pp_step = ${step + 3} AND @pp_session_mode_restored = 1 AND @pp_release_result = 1, ${sqlHex(successQuery)}, ${sqlHex(GUARD_FAILURE_QUERY)});`,
    "PREPARE pp_incremental_statement FROM @pp_sql;",
    "EXECUTE pp_incremental_statement;",
    "DEALLOCATE PREPARE pp_incremental_statement;",
    "SET @pp_candidate_sql = NULL;",
    "SET @pp_sql = NULL;",
    "SET @pp_target_database_sha256 = NULL;",
    "SET @pp_server_version_sha256 = NULL;",
    "SET @pp_selected_tag = NULL;",
    "SET @pp_expected_previous_tag = NULL;",
    "SET @pp_lock_name = NULL;",
    "SET @pp_lock_was_already_owned = NULL;",
    "SET @pp_bundle_id = NULL;",
    "SET @pp_lock_acquired = NULL;",
    "SET @pp_release_result = NULL;",
    "SET @pp_original_sql_mode = NULL;",
    "SET @pp_session_policy_applied = NULL;",
    "SET @pp_session_restore_applied = NULL;",
    "SET @pp_session_mode_restored = NULL;",
    "SET @pp_step = NULL;",
    "",
  );

  return compactSql(lines);
}

async function writeAtomic(path, content) {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, content);
    await rm(path, { force: true });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function displayPath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

export async function buildPhpMyAdminIncrementalMigrationBundle({
  migrationTag,
  outputDirectory = join(defaultProjectRoot, "dist"),
  projectRoot = defaultProjectRoot,
  serverVersionSha256,
  targetDatabaseSha256,
}) {
  validateMigrationTag(migrationTag);
  validateDigest(targetDatabaseSha256, "PHPMYADMIN_TARGET_DB_SHA256");
  validateDigest(
    serverVersionSha256,
    "PHPMYADMIN_SERVER_VERSION_SHA256",
  );

  const migrationsFolder = join(projectRoot, "drizzle");
  const expectedBefore = await readExpectedMigrations(migrationsFolder);
  const migrationIndex = expectedBefore.findIndex(
    (migration) => migration.sqlFileName === `${migrationTag}.sql`,
  );
  if (migrationIndex < 1) {
    throw new PhpMyAdminIncrementalBundleError(
      "Selected migration is not an incremental migration in the journal.",
    );
  }

  const expectedMigration = expectedBefore[migrationIndex];
  const previousExpectedMigration = expectedBefore[migrationIndex - 1];
  const migrationSql = await readFile(
    join(migrationsFolder, expectedMigration.sqlFileName),
    "utf8",
  );
  const statements = splitMigrationSql(migrationSql).map((sql) => ({
    analysis: analyzeMigrationStatement(sql),
    hash: sha256(sql),
    sql,
  }));
  const expectedAfter = await readExpectedMigrations(migrationsFolder);
  assertExpectedMigrationsUnchanged(expectedBefore, expectedAfter);

  const prefix = expectedBefore.slice(0, migrationIndex).map((migration) => ({
    ...migration,
    tag: migration.sqlFileName.replace(/\.sql$/u, ""),
  }));
  const migration = {
    ...expectedMigration,
    tag: migrationTag,
  };
  const previousMigration = {
    ...previousExpectedMigration,
    tag: previousExpectedMigration.sqlFileName.replace(/\.sql$/u, ""),
  };
  const targetObjects = statements.map((item) => ({
    name:
      item.analysis.type === "create-table"
        ? item.analysis.tableName
        : item.analysis.type === "create-index"
          ? item.analysis.indexName
          : item.analysis.constraintName,
    tableName: item.analysis.tableName,
    type: item.analysis.type,
  }));
  const bundleIdentity = {
    expectedJournalCount: prefix.length,
    expectedPreviousMigration: {
      createdAt: previousMigration.createdAt,
      hash: previousMigration.hash,
      tag: previousMigration.tag,
    },
    formatVersion: FORMAT_VERSION,
    migration: {
      createdAt: migration.createdAt,
      hash: migration.hash,
      statementHashes: statements.map((statement) => statement.hash),
      tag: migration.tag,
    },
    serverVersionSha256,
    sessionPolicy: {
      characterSet: MYSQL_SESSION_CHARACTER_SET,
      collation: MYSQL_SESSION_COLLATION,
      modifiesGlobalSqlMode: false,
      restoresOriginalSqlMode: true,
      sqlMode: MYSQL_SESSION_SQL_MODE,
      storageEngine: MYSQL_SESSION_STORAGE_ENGINE,
      timeZone: MYSQL_SESSION_TIME_ZONE,
    },
    targetDatabaseSha256,
    targetObjects,
  };
  const bundleId = sha256(`${JSON.stringify(bundleIdentity)}\n`);
  const sql = buildSql({
    bundleId,
    migration,
    prefix,
    previousMigration,
    serverVersionSha256,
    statements,
    targetDatabaseSha256,
  });
  const sqlSha256 = sha256(sql);
  const artifactStem = `portal-pusula-incremental-${migrationTag}`;
  const manifest = {
    ...bundleIdentity,
    boundary:
      "Forward-only existing-schema migration. DDL is not transactional; without the exact success row, stop and inspect read-only. A partial target is deliberately not rerunnable.",
    bundleId,
    sqlArtifact: `${artifactStem}.sql`,
    sqlBytes: Buffer.byteLength(sql),
    sqlSha256,
  };
  const sqlPath = join(outputDirectory, `${artifactStem}.sql`);
  const manifestPath = join(outputDirectory, `${artifactStem}.manifest.json`);
  await writeAtomic(sqlPath, sql);
  await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    bundleId,
    manifestPath: displayPath(projectRoot, manifestPath),
    migrationTag,
    sqlBytes: Buffer.byteLength(sql),
    sqlPath: displayPath(projectRoot, sqlPath),
    sqlSha256,
    statementCount: statements.length,
  };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const summary = await buildPhpMyAdminIncrementalMigrationBundle({
      migrationTag: process.env.PHPMYADMIN_INCREMENTAL_MIGRATION_TAG,
      serverVersionSha256: process.env.PHPMYADMIN_SERVER_VERSION_SHA256,
      targetDatabaseSha256: process.env.PHPMYADMIN_TARGET_DB_SHA256,
    });
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(
      error instanceof PhpMyAdminIncrementalBundleError
        ? error.message
        : "phpMyAdmin incremental migration bundle generation failed.",
    );
    process.exitCode = 1;
  }
}
