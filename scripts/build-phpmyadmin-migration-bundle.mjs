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

import {
  assertExpectedMigrationsUnchanged,
  DRIZZLE_MIGRATIONS_TABLE,
  MIGRATION_LOCK_DIGEST_HEX_LENGTH,
  MIGRATION_LOCK_PREFIX,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  readExpectedMigrations,
} from "./migration-integrity.mjs";

const FORMAT_VERSION = 1;
const MINIMUM_MARIADB_MAJOR = 10;
const MINIMUM_MARIADB_MINOR = 6;
const JOURNAL_TABLE = DRIZZLE_MIGRATIONS_TABLE;
const GUARD_FAILURE_QUERY = "PORTAL_PUSULA_BUNDLE_GUARD_FAILURE";
const SAFE_NOOP_QUERY = "SELECT 1 WHERE 0";
const migrationBreakpoint = /--> statement-breakpoint\s*/gu;
const safeIdentifier = /^[A-Za-z0-9_]{1,64}$/u;

const defaultProjectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class PhpMyAdminBundleError extends Error {
  constructor(message = "phpMyAdmin migration bundle generation failed.") {
    super(message);
    this.name = "PhpMyAdminBundleError";
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

function quotedIdentifier(identifier) {
  if (!safeIdentifier.test(identifier)) {
    throw new PhpMyAdminBundleError();
  }
  return `\`${identifier}\``;
}

function sqlStringList(values) {
  return values.map(sqlString).join(", ");
}

function validateTargetDatabaseSha256(targetDatabaseSha256) {
  if (
    typeof targetDatabaseSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(targetDatabaseSha256)
  ) {
    throw new PhpMyAdminBundleError(
      "PHPMYADMIN_TARGET_DB_SHA256 is missing or invalid.",
    );
  }
}

function validateServerVersionSha256(serverVersionSha256) {
  if (
    typeof serverVersionSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(serverVersionSha256)
  ) {
    throw new PhpMyAdminBundleError(
      "PHPMYADMIN_SERVER_VERSION_SHA256 is missing or invalid.",
    );
  }
}

function splitMigrationSql(sql) {
  const segments = sql.split(migrationBreakpoint);
  if (segments.some((segment) => segment.trim().length === 0)) {
    throw new PhpMyAdminBundleError();
  }
  const statements = segments.map((statement) =>
    statement.trim().replace(/;\s*$/u, "").trim(),
  );

  if (statements.length === 0) {
    throw new PhpMyAdminBundleError();
  }

  return statements;
}

function matchingClosingParenthesis(statement, openingIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openingIndex; index < statement.length; index += 1) {
    const character = statement[index];
    if (quote !== null) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (statement[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function parseCreateTable(statement) {
  const match = /^CREATE\s+TABLE\s+`([^`]+)`\s*\(/iu.exec(statement);
  if (!match) return null;

  const openingIndex = match[0].lastIndexOf("(");
  const closingIndex = matchingClosingParenthesis(statement, openingIndex);
  if (closingIndex < 0) throw new PhpMyAdminBundleError();
  const suffix = statement.slice(closingIndex + 1);
  if (
    !/^\s*ENGINE\s*=\s*InnoDB\s+DEFAULT\s+CHARACTER\s+SET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_unicode_ci(?:\s+COMMENT\s*=\s*'(?:[^'\\]|\\.|'')*')?\s*$/iu.test(
      suffix,
    )
  ) {
    throw new PhpMyAdminBundleError();
  }

  const tableName = match[1];
  quotedIdentifier(tableName);
  const columnNames = [...statement.matchAll(/^\s*`([^`]+)`\s+/gmu)].map(
    (column) => column[1],
  );
  if (columnNames.length === 0 || new Set(columnNames).size !== columnNames.length) {
    throw new PhpMyAdminBundleError();
  }
  for (const columnName of columnNames) quotedIdentifier(columnName);
  const jsonColumnNames = [
    ...statement.matchAll(/^\s*`([^`]+)`\s+json(?:\s|,)/gimu),
  ].map((column) => column[1]);

  const constraintNames = [
    ...statement.matchAll(/CONSTRAINT\s+`([^`]+)`\s+(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)/giu),
  ].map((constraint) => ({
    name: constraint[2].toUpperCase().startsWith("PRIMARY")
      ? "PRIMARY"
      : constraint[1],
    type: constraint[2].toUpperCase().replaceAll(/\s+/gu, " "),
  }));
  if (/^\s*PRIMARY\s+KEY\s*\(/imu.test(statement)) {
    constraintNames.push({ name: "PRIMARY", type: "PRIMARY KEY" });
  }
  for (const uniqueKey of statement.matchAll(
    /^\s*UNIQUE\s+KEY\s+`([^`]+)`\s*\(/gimu,
  )) {
    constraintNames.push({ name: uniqueKey[1], type: "UNIQUE" });
  }
  const uniqueConstraintKeys = new Set(
    constraintNames.map((constraint) => `${constraint.type}:${constraint.name}`),
  );
  if (uniqueConstraintKeys.size !== constraintNames.length) {
    throw new PhpMyAdminBundleError();
  }
  for (const constraint of constraintNames) quotedIdentifier(constraint.name);

  return {
    columnNames,
    constraintNames,
    jsonColumnNames,
    tableName,
    type: "create-table",
  };
}

function parseAlterConstraint(statement) {
  const match = /^ALTER\s+TABLE\s+`([^`]+)`\s+ADD\s+CONSTRAINT\s+`([^`]+)`\s+(FOREIGN\s+KEY|CHECK)\b/iu.exec(
    statement,
  );
  if (!match) return null;
  quotedIdentifier(match[1]);
  quotedIdentifier(match[2]);

  if (/\bFOREIGN\s+KEY\b/iu.test(match[3])) {
    const foreignKey = /^ALTER\s+TABLE\s+`[^`]+`\s+ADD\s+CONSTRAINT\s+`[^`]+`\s+FOREIGN\s+KEY\s*\(`([^`]+)`\)\s+REFERENCES\s+`([^`]+)`\s*\(`([^`]+)`\)\s+ON\s+DELETE\s+(RESTRICT)\s+ON\s+UPDATE\s+(RESTRICT)\s*$/iu.exec(
      statement,
    );
    if (!foreignKey) throw new PhpMyAdminBundleError();
    for (const identifier of foreignKey.slice(1, 4)) quotedIdentifier(identifier);
    return {
      columnName: foreignKey[1],
      constraintName: match[2],
      referencedColumnName: foreignKey[3],
      referencedTableName: foreignKey[2],
      tableName: match[1],
      type: "foreign-key",
    };
  }

  const checkRemainder = statement.slice(match[0].length).trimStart();
  if (checkRemainder[0] !== "(") throw new PhpMyAdminBundleError();
  const closingIndex = matchingClosingParenthesis(checkRemainder, 0);
  if (
    closingIndex < 0 ||
    checkRemainder.slice(closingIndex + 1).trim().length !== 0
  ) {
    throw new PhpMyAdminBundleError();
  }

  return {
    constraintName: match[2],
    tableName: match[1],
    type: "check",
  };
}

function parseCreateIndex(statement) {
  const match = /^CREATE\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\(([^)]+)\)$/iu.exec(
    statement.trim(),
  );
  if (!match) return null;
  quotedIdentifier(match[1]);
  quotedIdentifier(match[2]);
  const columnNames = [...match[3].matchAll(/`([^`]+)`/gu)].map(
    (column) => column[1],
  );
  const indexColumns = match[3].split(",").map((column) => column.trim());
  if (
    columnNames.length === 0 ||
    indexColumns.length !== columnNames.length ||
    indexColumns.some((column) => !/^`[A-Za-z0-9_]{1,64}`$/u.test(column))
  ) {
    throw new PhpMyAdminBundleError();
  }
  for (const columnName of columnNames) quotedIdentifier(columnName);
  return {
    columnNames,
    indexName: match[1],
    tableName: match[2],
    type: "create-index",
  };
}

function hasUnquotedSemicolon(statement) {
  let quote = null;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    if (quote !== null) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (statement[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      return true;
    }
  }
  return false;
}

export function analyzeMigrationStatement(statement) {
  if (
    typeof statement !== "string" ||
    statement.length === 0 ||
    /^\s*(?:DROP|TRUNCATE|RENAME|REPLACE|DELETE|UPDATE)\s/iu.test(
      statement,
    ) ||
    /\b(?:PREPARE|EXECUTE|DEALLOCATE|SIGNAL|RESIGNAL|DELIMITER|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/iu.test(
      statement,
    ) ||
    /@/u.test(statement) ||
    hasUnquotedSemicolon(statement)
  ) {
    throw new PhpMyAdminBundleError();
  }

  const analysis =
    parseCreateTable(statement) ??
    parseAlterConstraint(statement) ??
    parseCreateIndex(statement);
  if (!analysis) throw new PhpMyAdminBundleError();
  return analysis;
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

function guardedStatementLines({ statement, expectedStep, predicate }) {
  const candidateHash = sha256(statement);
  return [
    `SET @pp_candidate_sql = ${sqlHex(statement)};`,
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}, ${expectedStep}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}, @pp_candidate_sql, ${sqlHex(SAFE_NOOP_QUERY)});`,
    "PREPARE pp_bundle_statement FROM @pp_sql;",
    "EXECUTE pp_bundle_statement;",
    "DEALLOCATE PREPARE pp_bundle_statement;",
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${predicate}), ${expectedStep + 1}, -1);`,
  ];
}

function journalDefinition() {
  // Keep this equivalent to drizzle-orm/mysql-core's pinned migrator DDL.
  // The real MariaDB acceptance suite compares SHOW CREATE TABLE output from
  // this bundle with a fresh run by the official migration runner.
  return `CREATE TABLE IF NOT EXISTS \`${JOURNAL_TABLE}\` (
  \`id\` SERIAL PRIMARY KEY,
  \`hash\` TEXT NOT NULL,
  \`created_at\` BIGINT
)`;
}

function journalVerificationPredicate() {
  return `(SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = '${JOURNAL_TABLE}'
               AND TABLE_TYPE = 'BASE TABLE'
               AND ENGINE = 'InnoDB'
               AND TABLE_COLLATION LIKE 'utf8mb4\\_%') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}') = 3
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME IN ('id', 'hash', 'created_at')) = 3
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME = 'id'
                   AND DATA_TYPE = 'bigint'
                   AND COLUMN_TYPE LIKE '%unsigned%'
                   AND IS_NULLABLE = 'NO'
                   AND EXTRA LIKE '%auto_increment%') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME = 'hash'
                   AND DATA_TYPE = 'text'
                   AND IS_NULLABLE = 'NO') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME = 'created_at'
                   AND DATA_TYPE = 'bigint'
                   AND COLUMN_TYPE NOT LIKE '%unsigned%'
                   AND IS_NULLABLE = 'YES') = 1
          AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}') = 1
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND INDEX_NAME = 'PRIMARY'
                   AND NON_UNIQUE = 0
                   AND SEQ_IN_INDEX = 1
                   AND COLUMN_NAME = 'id') = 1`;
}

function expectedSchema(migrations) {
  const tables = new Map();
  const checks = [];
  const foreignKeys = [];
  const indexes = [];
  const jsonChecks = [];

  for (const migration of migrations) {
    for (const item of migration.statements) {
      const analysis = item.analysis;
      if (analysis.type === "create-table") {
        if (tables.has(analysis.tableName)) throw new PhpMyAdminBundleError();
        tables.set(analysis.tableName, [...analysis.columnNames]);
        for (const columnName of analysis.jsonColumnNames) {
          jsonChecks.push({ columnName, tableName: analysis.tableName });
        }
        for (const constraint of analysis.constraintNames) {
          if (constraint.type === "CHECK") {
            checks.push({ name: constraint.name, tableName: analysis.tableName });
          } else if (constraint.type === "UNIQUE") {
            indexes.push({ name: constraint.name, tableName: analysis.tableName });
          } else if (constraint.type === "PRIMARY KEY") {
            indexes.push({ name: "PRIMARY", tableName: analysis.tableName });
          }
        }
      } else if (analysis.type === "check") {
        checks.push({
          name: analysis.constraintName,
          tableName: analysis.tableName,
        });
      } else if (analysis.type === "foreign-key") {
        foreignKeys.push({
          name: analysis.constraintName,
          tableName: analysis.tableName,
        });
      } else {
        indexes.push({ name: analysis.indexName, tableName: analysis.tableName });
      }
    }
  }

  return {
    checks: checks.sort((left, right) =>
      `${left.tableName}:${left.name}`.localeCompare(
        `${right.tableName}:${right.name}`,
        "en",
      ),
    ),
    foreignKeys: foreignKeys.sort((left, right) =>
      `${left.tableName}:${left.name}`.localeCompare(
        `${right.tableName}:${right.name}`,
        "en",
      ),
    ),
    indexes: indexes.sort((left, right) =>
      `${left.tableName}:${left.name}`.localeCompare(
        `${right.tableName}:${right.name}`,
        "en",
      ),
    ),
    jsonChecks: jsonChecks.sort((left, right) =>
      `${left.tableName}:${left.columnName}`.localeCompare(
        `${right.tableName}:${right.columnName}`,
        "en",
      ),
    ),
    tables: Object.fromEntries([...tables.entries()].sort()),
  };
}

function postflightPredicate(
  schema,
  migrations,
  targetDatabaseSha256,
  serverVersionSha256,
) {
  const applicationTableNames = Object.keys(schema.tables);
  const allTableNames = [...applicationTableNames, JOURNAL_TABLE].sort();
  const totalApplicationColumns = Object.values(schema.tables).reduce(
    (total, columns) => total + columns.length,
    0,
  );
  const checkNames = schema.checks.map((constraint) => constraint.name);
  const foreignKeyNames = schema.foreignKeys.map((constraint) => constraint.name);
  const explicitIndexNames = schema.indexes.map((index) => index.name);

  const predicates = [
    `SHA2(DATABASE(), 256) = ${sqlString(targetDatabaseSha256)}`,
    `SHA2(VERSION(), 256) = ${sqlString(serverVersionSha256)}`,
    "@@SESSION.autocommit = 1",
    "@@SESSION.check_constraint_checks = 1",
    "@@SESSION.foreign_key_checks = 1",
    "@@SESSION.unique_checks = 1",
    "(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0)",
    "@@GLOBAL.check_constraint_checks = 1",
    "@@GLOBAL.foreign_key_checks = 1",
    "@@GLOBAL.unique_checks = 1",
    "(FIND_IN_SET('STRICT_TRANS_TABLES', @@GLOBAL.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@GLOBAL.sql_mode) > 0)",
    "@@SESSION.default_storage_engine = 'InnoDB'",
    "@@GLOBAL.default_storage_engine = 'InnoDB'",
    `(SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()) = ${allTableNames.length}`,
    `(SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${sqlStringList(applicationTableNames)})
          AND TABLE_TYPE = 'BASE TABLE'
          AND ENGINE = 'InnoDB'
          AND TABLE_COLLATION = 'utf8mb4_unicode_ci') = ${applicationTableNames.length}`,
    journalVerificationPredicate(),
    `(SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${sqlStringList(applicationTableNames)})) = ${totalApplicationColumns}`,
    `(SELECT COUNT(*) FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()) = 0`,
    `(SELECT COUNT(*) FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()) = 0`,
    `(SELECT COUNT(*) FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = DATABASE()) = 0`,
    `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`) = ${migrations.length}`,
  ];

  for (const [tableName, columns] of Object.entries(schema.tables)) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(tableName)}
            AND COLUMN_NAME IN (${sqlStringList(columns)})) = ${columns.length}`,
      `(SELECT COUNT(*) FROM ${quotedIdentifier(tableName)}) = 0`,
    );
  }

  if (checkNames.length > 0) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_TYPE = 'CHECK'
            AND CONSTRAINT_NAME IN (${sqlStringList(checkNames)})) = ${checkNames.length}`,
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_TYPE = 'CHECK') = ${checkNames.length + schema.jsonChecks.length}`,
      `(SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()) = ${checkNames.length + schema.jsonChecks.length}`,
    );
  }
  for (const jsonCheck of schema.jsonChecks) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(jsonCheck.tableName)}
            AND CONSTRAINT_TYPE = 'CHECK'
            AND CONSTRAINT_NAME = ${sqlString(jsonCheck.columnName)}) = 1`,
      `(SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_NAME = ${sqlString(jsonCheck.columnName)}
            AND CHECK_CLAUSE LIKE ${sqlString(`%json_valid(\`${jsonCheck.columnName}\`)%`)}) >= 1`,
    );
  }
  if (foreignKeyNames.length > 0) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_TYPE = 'FOREIGN KEY'
            AND CONSTRAINT_NAME IN (${sqlStringList(foreignKeyNames)})) = ${foreignKeyNames.length}`,
    );
  }
  if (explicitIndexNames.length > 0) {
    predicates.push(
      `(SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN (${sqlStringList(applicationTableNames)})
            AND INDEX_NAME IN (${sqlStringList(explicitIndexNames)})) = ${schema.indexes.length}`,
    );
  }

  for (const [index, migration] of migrations.entries()) {
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

function buildSql({
  migrations,
  schema,
  targetDatabaseSha256,
  serverVersionSha256,
  bundleId,
}) {
  const lines = [
    "-- Portal Pusula clean-only phpMyAdmin migration bundle.",
    `-- Format ${FORMAT_VERSION}; bundle ${bundleId}.`,
    "-- The target database name is intentionally not present in this artifact.",
    "-- Import only into the separately verified empty staging database.",
    "SET @pp_bundle_id = NULL;",
    "SET @pp_target_database_sha256 = NULL;",
    "SET @pp_server_version_sha256 = NULL;",
    "SET @pp_lock_name = NULL;",
    "SET @pp_lock_was_already_owned = NULL;",
    "SET @pp_lock_acquired = NULL;",
    "SET @pp_release_result = NULL;",
    "SET @pp_candidate_sql = NULL;",
    "SET @pp_sql = NULL;",
    "SET @pp_step = NULL;",
    "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;",
    "SET SESSION time_zone = '+00:00';",
    "SET SESSION autocommit = 1;",
    "SET SESSION check_constraint_checks = 1;",
    "SET SESSION foreign_key_checks = 1;",
    "SET SESSION unique_checks = 1;",
    `SET @pp_bundle_id = ${sqlString(bundleId)};`,
    `SET @pp_target_database_sha256 = ${sqlString(targetDatabaseSha256)};`,
    `SET @pp_server_version_sha256 = ${sqlString(serverVersionSha256)};`,
    `SET @pp_lock_name = CONCAT(${sqlString(MIGRATION_LOCK_PREFIX)}, LEFT(SHA2(DATABASE(), 256), ${MIGRATION_LOCK_DIGEST_HEX_LENGTH}));`,
    "SET @pp_lock_was_already_owned = COALESCE(IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID(), 0);",
    `SET @pp_lock_acquired = IF(@pp_lock_was_already_owned, 0, GET_LOCK(@pp_lock_name, ${MIGRATION_LOCK_TIMEOUT_SECONDS}));`,
    "SET @pp_step = IF(@pp_lock_acquired = 1 AND NOT @pp_lock_was_already_owned, 0, -1);",
    `SET @pp_step = IF(
      @pp_step = 0
      AND DATABASE() IS NOT NULL
      AND SHA2(DATABASE(), 256) = @pp_target_database_sha256
      AND SHA2(VERSION(), 256) = @pp_server_version_sha256
      AND LOCATE('MariaDB', VERSION()) > 0
      AND (
        CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) > ${MINIMUM_MARIADB_MAJOR}
        OR (
          CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) = ${MINIMUM_MARIADB_MAJOR}
          AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED) >= ${MINIMUM_MARIADB_MINOR}
        )
      )
      AND @@SESSION.character_set_connection = 'utf8mb4'
      AND @@SESSION.collation_connection = 'utf8mb4_unicode_ci'
      AND @@SESSION.autocommit = 1
      AND @@SESSION.check_constraint_checks = 1
      AND @@SESSION.foreign_key_checks = 1
      AND @@SESSION.unique_checks = 1
      AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0
        OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0)
      AND @@GLOBAL.check_constraint_checks = 1
      AND @@GLOBAL.foreign_key_checks = 1
      AND @@GLOBAL.unique_checks = 1
      AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@GLOBAL.sql_mode) > 0
        OR FIND_IN_SET('STRICT_ALL_TABLES', @@GLOBAL.sql_mode) > 0)
      AND @@SESSION.default_storage_engine = 'InnoDB'
      AND @@GLOBAL.default_storage_engine = 'InnoDB'
      AND (SELECT COUNT(*) FROM information_schema.ENGINES
             WHERE ENGINE = 'InnoDB' AND SUPPORT IN ('YES', 'DEFAULT')) = 1
      AND (SELECT COUNT(*) FROM information_schema.SCHEMATA
             WHERE SCHEMA_NAME = DATABASE()
               AND DEFAULT_CHARACTER_SET_NAME = 'utf8mb4') = 1
      AND (SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()) = 0
      AND (SELECT COUNT(*) FROM information_schema.ROUTINES
             WHERE ROUTINE_SCHEMA = DATABASE()) = 0
      AND (SELECT COUNT(*) FROM information_schema.TRIGGERS
             WHERE TRIGGER_SCHEMA = DATABASE()) = 0
      AND (SELECT COUNT(*) FROM information_schema.EVENTS
             WHERE EVENT_SCHEMA = DATABASE()) = 0,
      1,
      -1
    );`,
  ];

  let step = 1;
  lines.push(
    ...guardedStatementLines({
      expectedStep: step,
      predicate: journalVerificationPredicate(),
      statement: journalDefinition(),
    }),
  );
  step += 1;

  for (const [migrationIndex, migration] of migrations.entries()) {
    for (const item of migration.statements) {
      lines.push(
        ...guardedStatementLines({
          expectedStep: step,
          predicate: statementVerificationPredicate(item.analysis),
          statement: item.sql,
        }),
      );
      step += 1;
    }

    const journalInsert = `INSERT INTO \`${JOURNAL_TABLE}\` (\`hash\`, \`created_at\`) VALUES (${sqlString(migration.hash)}, ${migration.createdAt})`;
    lines.push(
      ...guardedStatementLines({
        expectedStep: step,
        predicate: `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`) = ${migrationIndex + 1}
          AND (SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`
                 WHERE id = ${migrationIndex + 1}
                   AND OCTET_LENGTH(hash) = 64
                   AND BINARY hash = BINARY ${sqlString(migration.hash)}
                   AND created_at = ${migration.createdAt}) = 1`,
        statement: journalInsert,
      }),
    );
    step += 1;
  }

  lines.push(
    `SET @pp_step = IF(@pp_step = ${step} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${postflightPredicate(
      schema,
      migrations,
      targetDatabaseSha256,
      serverVersionSha256,
    )}), ${step + 1}, -1);`,
    `SET @pp_release_result = IF(@pp_lock_acquired = 1 AND NOT @pp_lock_was_already_owned, RELEASE_LOCK(@pp_lock_name), 0);`,
    `SET @pp_step = IF(@pp_step = ${step + 1} AND @pp_release_result = 1 AND COALESCE(IS_USED_LOCK(@pp_lock_name) <> CONNECTION_ID(), 1), ${step + 2}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(@pp_step = ${step + 2} AND @pp_release_result = 1 AND COALESCE(IS_USED_LOCK(@pp_lock_name) <> CONNECTION_ID(), 1), ${sqlHex("SELECT 'PORTAL_PUSULA_MIGRATION_BUNDLE_OK' AS portal_pusula_migration_bundle_result")}, ${sqlHex(GUARD_FAILURE_QUERY)});`,
    "PREPARE pp_bundle_statement FROM @pp_sql;",
    "EXECUTE pp_bundle_statement;",
    "DEALLOCATE PREPARE pp_bundle_statement;",
    "SET @pp_candidate_sql = NULL;",
    "SET @pp_sql = NULL;",
    "SET @pp_target_database_sha256 = NULL;",
    "SET @pp_server_version_sha256 = NULL;",
    "SET @pp_lock_name = NULL;",
    "SET @pp_lock_was_already_owned = NULL;",
    "SET @pp_bundle_id = NULL;",
    "SET @pp_lock_acquired = NULL;",
    "SET @pp_release_result = NULL;",
    "SET @pp_step = NULL;",
    "",
  );

  // Every executable statement is deliberately one physical line. This keeps
  // the artifact compatible with phpMyAdmin's normal single-statement import
  // path and makes the integration harness exercise the same boundary.
  return `${lines
    .map((line) =>
      line.startsWith("--") || line === ""
        ? line
        : `${line.replaceAll(/\s*\r?\n\s*/gu, " ").trim()}`,
    )
    .join("\n")}\n`;
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

export async function buildPhpMyAdminMigrationBundle({
  projectRoot = defaultProjectRoot,
  outputDirectory = join(projectRoot, "dist"),
  targetDatabaseSha256,
  serverVersionSha256,
}) {
  validateTargetDatabaseSha256(targetDatabaseSha256);
  validateServerVersionSha256(serverVersionSha256);
  const migrationsFolder = join(projectRoot, "drizzle");
  const expectedBefore = await readExpectedMigrations(migrationsFolder);
  const migrations = [];

  for (const expected of expectedBefore) {
    const sql = await readFile(
      join(migrationsFolder, expected.sqlFileName),
      "utf8",
    );
    const statements = splitMigrationSql(sql).map((statement) => ({
      analysis: analyzeMigrationStatement(statement),
      hash: sha256(statement),
      sql: statement,
    }));
    migrations.push({ ...expected, statements });
  }

  const expectedAfter = await readExpectedMigrations(migrationsFolder);
  assertExpectedMigrationsUnchanged(expectedBefore, expectedAfter);

  const schema = expectedSchema(migrations);
  const bundleIdentity = {
    formatVersion: FORMAT_VERSION,
    minimumMariaDb: `${MINIMUM_MARIADB_MAJOR}.${MINIMUM_MARIADB_MINOR}`,
    migrations: migrations.map((migration) => ({
      createdAt: migration.createdAt,
      hash: migration.hash,
      sqlFileName: migration.sqlFileName,
      statementHashes: migration.statements.map((statement) => statement.hash),
    })),
    schema,
    targetDatabaseSha256,
    serverVersionSha256,
  };
  const bundleId = sha256(`${JSON.stringify(bundleIdentity)}\n`);
  const sql = buildSql({
    bundleId,
    migrations,
    schema,
    targetDatabaseSha256,
    serverVersionSha256,
  });
  const sqlSha256 = sha256(sql);
  const manifest = {
    ...bundleIdentity,
    boundary:
      "Clean-only phpMyAdmin bootstrap. A partial DDL failure requires deleting and recreating the disposable target; this is not a rollback or backup artifact.",
    bundleId,
    sqlArtifact: "portal-pusula-phpmyadmin-migration.sql",
    sqlBytes: Buffer.byteLength(sql),
    sqlSha256,
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const sqlPath = join(
    outputDirectory,
    "portal-pusula-phpmyadmin-migration.sql",
  );
  const manifestPath = join(
    outputDirectory,
    "portal-pusula-phpmyadmin-migration.manifest.json",
  );
  await writeAtomic(sqlPath, sql);
  await writeAtomic(manifestPath, manifestJson);

  return {
    bundleId,
    manifestPath: displayPath(projectRoot, manifestPath),
    migrationCount: migrations.length,
    sqlBytes: Buffer.byteLength(sql),
    sqlPath: displayPath(projectRoot, sqlPath),
    sqlSha256,
    statementCount: migrations.reduce(
      (count, migration) => count + migration.statements.length,
      0,
    ),
    targetDatabaseSha256,
    serverVersionSha256,
  };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const summary = await buildPhpMyAdminMigrationBundle({
      targetDatabaseSha256: process.env.PHPMYADMIN_TARGET_DB_SHA256,
      serverVersionSha256: process.env.PHPMYADMIN_SERVER_VERSION_SHA256,
    });
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(
      error instanceof PhpMyAdminBundleError
        ? error.message
        : "phpMyAdmin migration bundle generation failed.",
    );
    process.exitCode = 1;
  }
}
