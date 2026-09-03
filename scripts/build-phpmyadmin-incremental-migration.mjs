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

const FORMAT_VERSION = 2;
const JOURNAL_TABLE = DRIZZLE_MIGRATIONS_TABLE;
const GUARD_FAILURE_QUERY =
  "PORTAL_PUSULA_INCREMENTAL_MIGRATION_GUARD_FAILURE";
const SAFE_NOOP_QUERY = "SELECT 1 WHERE 0";
const migrationBreakpoint = /--> statement-breakpoint\s*/gu;
const migrationTagPattern = /^[0-9]{4}_[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const safeIdentifier = /^[A-Za-z0-9_]{1,64}$/u;
const CUSTOMER_PROJECTS_PARTNERSHIP_MIGRATION_TAG =
  "0011_customer_projects_partnership";

const allowedAddedColumns = new Map([
  ["consulting_contract:project_id", { columnName: "project_id", tableName: "consulting_contract" }],
  ["receivable:project_id", { columnName: "project_id", tableName: "receivable" }],
]);

const allowedCompositeForeignKeys = new Map([
  [
    "consulting_contract:fk_consulting_contract_customer_project",
    {
      columnNames: ["customer_id", "project_id"],
      constraintName: "fk_consulting_contract_customer_project",
      referencedColumnNames: ["customer_id", "project_id"],
      referencedTableName: "customer_project",
      tableName: "consulting_contract",
    },
  ],
  [
    "receivable:fk_receivable_customer_project",
    {
      columnNames: ["customer_id", "project_id"],
      constraintName: "fk_receivable_customer_project",
      referencedColumnNames: ["customer_id", "project_id"],
      referencedTableName: "customer_project",
      tableName: "receivable",
    },
  ],
]);

const customerProjectBackfillSql = `INSERT INTO \`customer_project\` (\`customer_id\`, \`project_id\`, \`status\`, \`version\`, \`created_at_utc\`, \`updated_at_utc\`) SELECT \`seed\`.\`customer_id\`, \`seed\`.\`project_id\`, 'active', 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6) FROM (SELECT \`customer\`.\`id\` AS \`customer_id\`, \`project\`.\`id\` AS \`project_id\` FROM \`customer\` CROSS JOIN \`project\` WHERE BINARY \`project\`.\`short_code\` = BINARY 'MUHENDIS_KAFASI' UNION DISTINCT SELECT \`work_task\`.\`customer_id\` AS \`customer_id\`, \`work_task_project\`.\`project_id\` AS \`project_id\` FROM \`work_task\` JOIN \`work_task_project\` ON \`work_task_project\`.\`task_id\` = \`work_task\`.\`id\` WHERE \`work_task\`.\`customer_id\` IS NOT NULL) AS \`seed\``;
const consultingContractBackfillSql = `UPDATE \`consulting_contract\` JOIN \`project\` ON BINARY \`project\`.\`short_code\` = BINARY 'MUHENDIS_KAFASI' SET \`consulting_contract\`.\`project_id\` = \`project\`.\`id\` WHERE \`consulting_contract\`.\`project_id\` IS NULL`;
const receivableBackfillSql = `UPDATE \`receivable\` LEFT JOIN \`consulting_contract\` ON \`consulting_contract\`.\`id\` = \`receivable\`.\`contract_id\` JOIN \`project\` ON BINARY \`project\`.\`short_code\` = BINARY 'MUHENDIS_KAFASI' SET \`receivable\`.\`project_id\` = COALESCE(\`consulting_contract\`.\`project_id\`, \`project\`.\`id\`) WHERE \`receivable\`.\`project_id\` IS NULL`;

export const incrementalMigration0011BackfillStatements = Object.freeze({
  consultingContract: consultingContractBackfillSql,
  customerProject: customerProjectBackfillSql,
  receivable: receivableBackfillSql,
});

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

function quotedIdentifier(identifier) {
  if (!safeIdentifier.test(identifier)) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  return `\`${identifier}\``;
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

function normalizeStatementWhitespace(statement) {
  return statement.replaceAll(/\s+/gu, " ").trim();
}

function parseIdentifierList(value) {
  const parts = value.split(",").map((part) => part.trim());
  if (
    parts.length === 0 ||
    parts.some((part) => !/^`[A-Za-z0-9_]{1,64}`$/u.test(part))
  ) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  const identifiers = parts.map((part) => part.slice(1, -1));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  return identifiers;
}

function parseIncrementalAddColumn(statement) {
  const match = /^ALTER\s+TABLE\s+`([^`]+)`\s+ADD(?:\s+COLUMN)?\s+`([^`]+)`\s+char\(36\)\s+CHARACTER\s+SET\s+ascii\s+COLLATE\s+ascii_bin\s*$/iu.exec(
    statement,
  );
  if (!match) return null;
  quotedIdentifier(match[1]);
  quotedIdentifier(match[2]);
  const allowed = allowedAddedColumns.get(`${match[1]}:${match[2]}`);
  if (!allowed) throw new PhpMyAdminIncrementalBundleError();
  return {
    ...allowed,
    characterSet: "ascii",
    collation: "ascii_bin",
    length: 36,
    nullable: true,
    type: "add-column",
  };
}

function parseIncrementalForeignKey(statement) {
  const match = /^ALTER\s+TABLE\s+`([^`]+)`\s+ADD\s+CONSTRAINT\s+`([^`]+)`\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`([^`]+)`\s*\(([^)]+)\)\s+ON\s+DELETE\s+RESTRICT\s+ON\s+UPDATE\s+RESTRICT\s*$/iu.exec(
    statement,
  );
  if (!match) return null;
  for (const identifier of [match[1], match[2], match[4]]) {
    quotedIdentifier(identifier);
  }
  const columnNames = parseIdentifierList(match[3]);
  const referencedColumnNames = parseIdentifierList(match[5]);
  if (columnNames.length !== referencedColumnNames.length) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  if (columnNames.length > 1) {
    const allowed = allowedCompositeForeignKeys.get(`${match[1]}:${match[2]}`);
    if (
      !allowed ||
      allowed.referencedTableName !== match[4] ||
      allowed.columnNames.length !== columnNames.length ||
      allowed.referencedColumnNames.length !== referencedColumnNames.length ||
      allowed.columnNames.some((columnName, index) =>
        columnName !== columnNames[index]
      ) ||
      allowed.referencedColumnNames.some((columnName, index) =>
        columnName !== referencedColumnNames[index]
      )
    ) {
      throw new PhpMyAdminIncrementalBundleError();
    }
  }
  return {
    columnNames,
    constraintName: match[2],
    referencedColumnNames,
    referencedTableName: match[4],
    tableName: match[1],
    type: "foreign-key",
  };
}

function parseIncrementalCreateIndex(statement) {
  const match = /^CREATE\s+(UNIQUE\s+)?INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\(([^)]+)\)\s*$/iu.exec(
    statement,
  );
  if (!match) return null;
  quotedIdentifier(match[2]);
  quotedIdentifier(match[3]);
  return {
    columnNames: parseIdentifierList(match[4]),
    indexName: match[2],
    tableName: match[3],
    type: "create-index",
    unique: match[1] !== undefined,
  };
}

function parseIncrementalDropIndex(statement) {
  const match = /^DROP\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*$/iu.exec(
    statement,
  );
  if (!match) return null;
  quotedIdentifier(match[1]);
  quotedIdentifier(match[2]);
  if (
    match[1] !== "uq_consulting_contract_customer_start" ||
    match[2] !== "consulting_contract"
  ) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  return {
    columnNames: ["customer_id", "starts_on"],
    indexName: match[1],
    tableName: match[2],
    type: "drop-index",
    unique: true,
  };
}

function parseIncrementalDataBackfill(statement) {
  const normalized = normalizeStatementWhitespace(statement);
  if (normalized === customerProjectBackfillSql) {
    return {
      backfillKind: "customer-project-muhendis-kafasi",
      name: "backfill_customer_project_muhendis_kafasi",
      tableName: "customer_project",
      type: "data-backfill",
    };
  }
  if (normalized === consultingContractBackfillSql) {
    return {
      backfillKind: "consulting-contract-muhendis-kafasi",
      name: "backfill_consulting_contract_muhendis_kafasi",
      tableName: "consulting_contract",
      type: "data-backfill",
    };
  }
  if (normalized === receivableBackfillSql) {
    return {
      backfillKind: "receivable-contract-or-muhendis-kafasi",
      name: "backfill_receivable_contract_or_muhendis_kafasi",
      tableName: "receivable",
      type: "data-backfill",
    };
  }
  return null;
}

export function analyzeIncrementalMigrationStatement(statement, migrationTag) {
  if (
    typeof statement !== "string" ||
    statement.length === 0 ||
    hasUnquotedSemicolon(statement) ||
    /(?:--|#|\/\*)/u.test(statement) ||
    /\b(?:PREPARE|EXECUTE|DEALLOCATE|SIGNAL|RESIGNAL|DELIMITER|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/iu.test(
      statement,
    ) ||
    /@/u.test(statement)
  ) {
    throw new PhpMyAdminIncrementalBundleError();
  }

  if (migrationTag !== CUSTOMER_PROJECTS_PARTNERSHIP_MIGRATION_TAG) {
    return analyzeMigrationStatement(statement);
  }

  const analysis =
    parseIncrementalDataBackfill(statement) ??
    parseIncrementalAddColumn(statement) ??
    parseIncrementalForeignKey(statement) ??
    parseIncrementalCreateIndex(statement) ??
    parseIncrementalDropIndex(statement);
  if (analysis) return analysis;

  if (/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP)\b/iu.test(statement)) {
    throw new PhpMyAdminIncrementalBundleError();
  }
  return analyzeMigrationStatement(statement);
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

function orderedIndexPredicate({
  columnNames,
  indexName,
  tableName,
  unique,
}) {
  const nonUnique = unique ? 0 : 1;
  return [
    `(SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${sqlString(tableName)}
          AND INDEX_NAME = ${sqlString(indexName)}) = ${columnNames.length}`,
    `(SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${sqlString(tableName)}
          AND INDEX_NAME = ${sqlString(indexName)}
          AND NON_UNIQUE = ${nonUnique}
          AND INDEX_TYPE = 'BTREE') = ${columnNames.length}`,
    ...columnNames.map(
      (columnName, index) =>
        `(SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ${sqlString(tableName)}
              AND INDEX_NAME = ${sqlString(indexName)}
              AND SEQ_IN_INDEX = ${index + 1}
              AND COLUMN_NAME = ${sqlString(columnName)}
              AND NON_UNIQUE = ${nonUnique}) = 1`,
    ),
  ].join(" AND ");
}

function muhendisKafasiProjectPredicate() {
  return `(SELECT COUNT(*) FROM \`project\`
             WHERE BINARY \`short_code\` = BINARY 'MUHENDIS_KAFASI') = 1
          AND (SELECT COUNT(*) FROM \`project\`
                 WHERE BINARY \`short_code\` = BINARY 'MUHENDIS_KAFASI'
                   AND BINARY \`status\` = BINARY 'active') = 1`;
}

function dataBackfillPreflightPredicate(backfillKind) {
  if (backfillKind === "customer-project-muhendis-kafasi") {
    return [
      `(${muhendisKafasiProjectPredicate()})`,
      `(SELECT COUNT(*) FROM \`customer_project\`) = 0`,
      `(SELECT COUNT(*)
          FROM \`work_task\` wt
          JOIN \`work_task_project\` wtp ON wtp.\`task_id\` = wt.\`id\`
          LEFT JOIN \`customer\` c ON c.\`id\` = wt.\`customer_id\`
          LEFT JOIN \`project\` p ON p.\`id\` = wtp.\`project_id\`
         WHERE wt.\`customer_id\` IS NOT NULL
           AND (c.\`id\` IS NULL OR p.\`id\` IS NULL)) = 0`,
    ].join(" AND ");
  }
  if (backfillKind === "consulting-contract-muhendis-kafasi") {
    return [
      `(${muhendisKafasiProjectPredicate()})`,
      `(SELECT COUNT(*) FROM \`consulting_contract\` WHERE \`project_id\` IS NOT NULL) = 0`,
      `(SELECT COUNT(*)
          FROM \`customer\` c
          JOIN \`project\` p
            ON BINARY p.\`short_code\` = BINARY 'MUHENDIS_KAFASI'
          LEFT JOIN \`customer_project\` cp
            ON cp.\`customer_id\` = c.\`id\`
           AND cp.\`project_id\` = p.\`id\`
           AND BINARY cp.\`status\` = BINARY 'active'
         WHERE cp.\`customer_id\` IS NULL) = 0`,
    ].join(" AND ");
  }
  if (backfillKind === "receivable-contract-or-muhendis-kafasi") {
    return [
      `(${muhendisKafasiProjectPredicate()})`,
      `(SELECT COUNT(*) FROM \`receivable\` WHERE \`project_id\` IS NOT NULL) = 0`,
      `(SELECT COUNT(*) FROM \`consulting_contract\` WHERE \`project_id\` IS NULL) = 0`,
      `(SELECT COUNT(*)
          FROM \`receivable\` r
          LEFT JOIN \`consulting_contract\` cc ON cc.\`id\` = r.\`contract_id\`
         WHERE r.\`contract_id\` IS NOT NULL AND cc.\`id\` IS NULL) = 0`,
    ].join(" AND ");
  }
  throw new PhpMyAdminIncrementalBundleError();
}

function dataBackfillPostflightPredicate(backfillKind) {
  if (backfillKind === "customer-project-muhendis-kafasi") {
    return [
      `(${muhendisKafasiProjectPredicate()})`,
      `(SELECT COUNT(*)
          FROM \`customer_project\`) = (
            SELECT COUNT(*) FROM (
              SELECT c.\`id\` AS customer_id, p.\`id\` AS project_id
                FROM \`customer\` c
                CROSS JOIN \`project\` p
               WHERE BINARY p.\`short_code\` = BINARY 'MUHENDIS_KAFASI'
              UNION DISTINCT
              SELECT wt.\`customer_id\`, wtp.\`project_id\`
                FROM \`work_task\` wt
                JOIN \`work_task_project\` wtp ON wtp.\`task_id\` = wt.\`id\`
               WHERE wt.\`customer_id\` IS NOT NULL
            ) expected_customer_project
          )`,
      `(SELECT COUNT(*) FROM \`customer_project\`
         WHERE BINARY \`status\` <> BINARY 'active'
            OR \`version\` <> 1
            OR \`created_at_utc\` <> \`updated_at_utc\`) = 0`,
      `(SELECT COUNT(*)
          FROM \`customer\` c
          JOIN \`project\` p
            ON BINARY p.\`short_code\` = BINARY 'MUHENDIS_KAFASI'
          LEFT JOIN \`customer_project\` cp
            ON cp.\`customer_id\` = c.\`id\`
           AND cp.\`project_id\` = p.\`id\`
         WHERE cp.\`customer_id\` IS NULL) = 0`,
      `(SELECT COUNT(*)
          FROM \`work_task\` wt
          JOIN \`work_task_project\` wtp ON wtp.\`task_id\` = wt.\`id\`
          LEFT JOIN \`customer_project\` cp
            ON cp.\`customer_id\` = wt.\`customer_id\`
           AND cp.\`project_id\` = wtp.\`project_id\`
         WHERE wt.\`customer_id\` IS NOT NULL
           AND cp.\`customer_id\` IS NULL) = 0`,
    ].join(" AND ");
  }
  if (backfillKind === "consulting-contract-muhendis-kafasi") {
    return [
      `(SELECT COUNT(*) FROM \`consulting_contract\` WHERE \`project_id\` IS NULL) = 0`,
      `(SELECT COUNT(*)
          FROM \`consulting_contract\` cc
          JOIN \`project\` p ON p.\`id\` = cc.\`project_id\`
         WHERE BINARY p.\`short_code\` <> BINARY 'MUHENDIS_KAFASI') = 0`,
      `(SELECT COUNT(*)
          FROM \`consulting_contract\` cc
          LEFT JOIN \`customer_project\` cp
            ON cp.\`customer_id\` = cc.\`customer_id\`
           AND cp.\`project_id\` = cc.\`project_id\`
         WHERE cp.\`customer_id\` IS NULL) = 0`,
    ].join(" AND ");
  }
  if (backfillKind === "receivable-contract-or-muhendis-kafasi") {
    return [
      `(SELECT COUNT(*) FROM \`receivable\` WHERE \`project_id\` IS NULL) = 0`,
      `(SELECT COUNT(*)
          FROM \`receivable\` r
          JOIN \`consulting_contract\` cc ON cc.\`id\` = r.\`contract_id\`
         WHERE r.\`project_id\` <> cc.\`project_id\`) = 0`,
      `(SELECT COUNT(*)
          FROM \`receivable\` r
          JOIN \`project\` p ON p.\`id\` = r.\`project_id\`
         WHERE r.\`contract_id\` IS NULL
           AND BINARY p.\`short_code\` <> BINARY 'MUHENDIS_KAFASI') = 0`,
      `(SELECT COUNT(*)
          FROM \`receivable\` r
          LEFT JOIN \`customer_project\` cp
            ON cp.\`customer_id\` = r.\`customer_id\`
           AND cp.\`project_id\` = r.\`project_id\`
         WHERE cp.\`customer_id\` IS NULL) = 0`,
    ].join(" AND ");
  }
  throw new PhpMyAdminIncrementalBundleError();
}

function statementVerificationPredicate(analysis) {
  if (analysis.type === "add-column") {
    return `(SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND COLUMN_NAME = ${sqlString(analysis.columnName)}
                 AND DATA_TYPE = 'char'
                 AND COLUMN_TYPE = 'char(36)'
                 AND CHARACTER_MAXIMUM_LENGTH = 36
                 AND CHARACTER_SET_NAME = 'ascii'
                 AND COLLATION_NAME = 'ascii_bin'
                 AND IS_NULLABLE = 'YES'
                 AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
                 AND EXTRA = '') = 1`;
  }

  if (analysis.type === "data-backfill") {
    return dataBackfillPostflightPredicate(analysis.backfillKind);
  }

  if (analysis.type === "drop-index") {
    return `(SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND INDEX_NAME = ${sqlString(analysis.indexName)}) = 0`;
  }

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
    const columnNames = analysis.columnNames ?? [analysis.columnName];
    const referencedColumnNames =
      analysis.referencedColumnNames ?? [analysis.referencedColumnName];
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
            AND REFERENCED_TABLE_NAME = ${sqlString(analysis.referencedTableName)}) = ${columnNames.length}`,
      ...columnNames.map(
        (columnName, index) =>
          `(SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
              WHERE CONSTRAINT_SCHEMA = DATABASE()
                AND TABLE_NAME = ${sqlString(analysis.tableName)}
                AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
                AND ORDINAL_POSITION = ${index + 1}
                AND POSITION_IN_UNIQUE_CONSTRAINT = ${index + 1}
                AND COLUMN_NAME = ${sqlString(columnName)}
                AND REFERENCED_TABLE_NAME = ${sqlString(analysis.referencedTableName)}
                AND REFERENCED_COLUMN_NAME = ${sqlString(referencedColumnNames[index])}) = 1`,
      ),
      `(SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
            AND UPDATE_RULE = 'RESTRICT'
            AND DELETE_RULE = 'RESTRICT') = 1`,
    ].join(" AND ");
  }

  if (analysis.unique !== undefined) {
    return orderedIndexPredicate(analysis);
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
  if (analysis.type === "add-column") {
    return `(SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND COLUMN_NAME = ${sqlString(analysis.columnName)}) = 0`;
  }
  if (analysis.type === "drop-index") {
    return orderedIndexPredicate(analysis);
  }
  if (analysis.type === "data-backfill") {
    return `(${muhendisKafasiProjectPredicate()})`;
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

function statementPreflightPredicate(analysis) {
  if (analysis.type === "create-table") {
    return statementAbsentPredicate(analysis);
  }
  if (analysis.type === "add-column") {
    return [
      existingTablePredicate(analysis.tableName),
      statementAbsentPredicate(analysis),
    ].join(" AND ");
  }
  if (analysis.type === "data-backfill") {
    return dataBackfillPreflightPredicate(analysis.backfillKind);
  }
  if (analysis.type === "drop-index") {
    return orderedIndexPredicate(analysis);
  }
  if (analysis.type === "foreign-key") {
    const columnNames = analysis.columnNames ?? [analysis.columnName];
    const referencedColumnNames =
      analysis.referencedColumnNames ?? [analysis.referencedColumnName];
    return [
      statementAbsentPredicate(analysis),
      ...columnNames.map((columnName) =>
        existingColumnPredicate(analysis.tableName, columnName)
      ),
      ...referencedColumnNames.map((columnName) =>
        existingColumnPredicate(analysis.referencedTableName, columnName)
      ),
    ].join(" AND ");
  }
  if (analysis.type === "create-index") {
    return [
      statementAbsentPredicate(analysis),
      ...analysis.columnNames.map((columnName) =>
        existingColumnPredicate(analysis.tableName, columnName)
      ),
    ].join(" AND ");
  }
  return [
    existingTablePredicate(analysis.tableName),
    statementAbsentPredicate(analysis),
  ].join(" AND ");
}

function prerequisitePredicates(statements) {
  const createdTables = new Set(
    statements
      .filter((item) => item.analysis.type === "create-table")
      .map((item) => item.analysis.tableName),
  );
  const addedColumns = new Set(
    statements
      .filter((item) => item.analysis.type === "add-column")
      .map(
        (item) =>
          `${item.analysis.tableName}:${item.analysis.columnName}`,
      ),
  );
  const predicates = new Set();

  function requireTable(tableName) {
    if (!createdTables.has(tableName)) {
      predicates.add(existingTablePredicate(tableName));
    }
  }

  function requireColumn(tableName, columnName) {
    if (
      !createdTables.has(tableName) &&
      !addedColumns.has(`${tableName}:${columnName}`)
    ) {
      requireTable(tableName);
      predicates.add(existingColumnPredicate(tableName, columnName));
    }
  }

  for (const item of statements) {
    const { analysis, sql } = item;
    if (analysis.type === "foreign-key") {
      const columnNames = analysis.columnNames ?? [analysis.columnName];
      const referencedColumnNames =
        analysis.referencedColumnNames ?? [analysis.referencedColumnName];
      for (const columnName of columnNames) {
        requireColumn(analysis.tableName, columnName);
      }
      for (const columnName of referencedColumnNames) {
        requireColumn(analysis.referencedTableName, columnName);
      }
    } else if (analysis.type === "create-index") {
      for (const columnName of analysis.columnNames) {
        requireColumn(analysis.tableName, columnName);
      }
    } else if (
      analysis.type === "check" ||
      analysis.type === "add-column" ||
      analysis.type === "drop-index"
    ) {
      requireTable(analysis.tableName);
    } else if (analysis.type === "data-backfill") {
      if (analysis.backfillKind === "customer-project-muhendis-kafasi") {
        requireColumn("customer", "id");
        requireColumn("project", "id");
        requireColumn("project", "short_code");
        requireColumn("project", "status");
        requireColumn("work_task", "id");
        requireColumn("work_task", "customer_id");
        requireColumn("work_task_project", "task_id");
        requireColumn("work_task_project", "project_id");
        requireTable("customer_project");
      } else if (
        analysis.backfillKind === "consulting-contract-muhendis-kafasi"
      ) {
        requireColumn("consulting_contract", "project_id");
        requireColumn("customer", "id");
        requireColumn("project", "id");
        requireColumn("project", "short_code");
        requireColumn("project", "status");
        requireTable("customer_project");
      } else if (
        analysis.backfillKind === "receivable-contract-or-muhendis-kafasi"
      ) {
        requireColumn("receivable", "project_id");
        requireColumn("receivable", "contract_id");
        requireColumn("consulting_contract", "id");
        requireColumn("consulting_contract", "project_id");
        requireColumn("project", "id");
        requireColumn("project", "short_code");
        requireColumn("project", "status");
      }
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

function guardedStatementLines({
  statement,
  expectedStep,
  postflightPredicate,
  preflightPredicate,
}) {
  const candidateHash = sha256(statement);
  const sessionGuard = `@pp_session_policy_applied = 1 AND (${mysqlSessionPolicyPredicate()})`;
  const executionGuard = `@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionGuard}) AND (${preflightPredicate}) AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}`;
  return [
    `SET @pp_candidate_sql = ${sqlHex(statement)};`,
    `SET @pp_step = IF(${executionGuard}, ${expectedStep}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(${executionGuard}, @pp_candidate_sql, ${sqlHex(SAFE_NOOP_QUERY)});`,
    "PREPARE pp_incremental_statement FROM @pp_sql;",
    "EXECUTE pp_incremental_statement;",
    "DEALLOCATE PREPARE pp_incremental_statement;",
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionGuard}) AND (${postflightPredicate}), ${expectedStep + 1}, -1);`,
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
        postflightPredicate: statementVerificationPredicate(item.analysis),
        preflightPredicate: statementPreflightPredicate(item.analysis),
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
      postflightPredicate: exactJournalPostflightPredicate(prefix, migration),
      preflightPredicate: exactJournalPrefixPredicate(prefix, migration),
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
    analysis: analyzeIncrementalMigrationStatement(sql, migrationTag),
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
        : item.analysis.type === "create-index" ||
            item.analysis.type === "drop-index"
          ? item.analysis.indexName
          : item.analysis.type === "add-column"
            ? item.analysis.columnName
            : item.analysis.type === "data-backfill"
              ? item.analysis.name
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
