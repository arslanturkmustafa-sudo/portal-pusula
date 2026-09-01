export const MYSQL_SESSION_SQL_MODE =
  "STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION";

export const MYSQL_SESSION_CHARACTER_SET = "utf8mb4";
export const MYSQL_SESSION_COLLATION = "utf8mb4_unicode_ci";
export const MYSQL_SESSION_TIME_ZONE = "+00:00";
export const MYSQL_SESSION_STORAGE_ENGINE = "InnoDB";
export const MYSQL_SESSION_POLICY_QUERY_TIMEOUT_MS = 2_000;

export const MYSQL_SESSION_POLICY_SET_STATEMENTS = Object.freeze([
  Object.freeze({
    sql: `SET
      @@SESSION.sql_mode = ?,
      @@SESSION.character_set_client = 'utf8mb4',
      @@SESSION.character_set_connection = 'utf8mb4',
      @@SESSION.character_set_results = 'utf8mb4',
      @@SESSION.collation_connection = 'utf8mb4_unicode_ci',
      @@SESSION.time_zone = '+00:00',
      @@SESSION.autocommit = 1,
      @@SESSION.check_constraint_checks = 1,
      @@SESSION.foreign_key_checks = 1,
      @@SESSION.unique_checks = 1,
      @@SESSION.default_storage_engine = 'InnoDB'`,
    values: Object.freeze([MYSQL_SESSION_SQL_MODE]),
  }),
]);

export const MYSQL_SESSION_POLICY_READBACK_SQL = `SELECT
  DATABASE() AS current_database,
  @@SESSION.character_set_client AS character_set_client,
  @@SESSION.character_set_connection AS character_set_connection,
  @@SESSION.character_set_results AS character_set_results,
  @@SESSION.collation_connection AS collation_connection,
  @@SESSION.time_zone AS time_zone,
  @@SESSION.autocommit AS autocommit,
  @@SESSION.check_constraint_checks AS check_constraint_checks,
  @@SESSION.foreign_key_checks AS foreign_key_checks,
  @@SESSION.unique_checks AS unique_checks,
  @@SESSION.default_storage_engine AS default_storage_engine,
  @@SESSION.sql_mode AS sql_mode`;

export class MySqlSessionPolicyError extends Error {
  constructor() {
    super("Database session policy could not be established.");
    this.name = "MySqlSessionPolicyError";
  }
}

function hasEnabledFlag(value) {
  return value === 1 || value === "1";
}

export function isCanonicalMySqlSessionRow(row, expectedDatabaseName) {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof expectedDatabaseName === "string" &&
    expectedDatabaseName.length > 0 &&
    row.current_database === expectedDatabaseName &&
    row.character_set_client === MYSQL_SESSION_CHARACTER_SET &&
    row.character_set_connection === MYSQL_SESSION_CHARACTER_SET &&
    row.character_set_results === MYSQL_SESSION_CHARACTER_SET &&
    row.collation_connection === MYSQL_SESSION_COLLATION &&
    row.time_zone === MYSQL_SESSION_TIME_ZONE &&
    hasEnabledFlag(row.autocommit) &&
    hasEnabledFlag(row.check_constraint_checks) &&
    hasEnabledFlag(row.foreign_key_checks) &&
    hasEnabledFlag(row.unique_checks) &&
    row.default_storage_engine === MYSQL_SESSION_STORAGE_ENGINE &&
    row.sql_mode === MYSQL_SESSION_SQL_MODE
  );
}

export async function applyMySqlSessionPolicy(connection, expectedDatabaseName) {
  try {
    if (
      typeof expectedDatabaseName !== "string" ||
      expectedDatabaseName.length === 0
    ) {
      throw new MySqlSessionPolicyError();
    }

    for (const statement of MYSQL_SESSION_POLICY_SET_STATEMENTS) {
      await connection.query({
        sql: statement.sql,
        timeout: MYSQL_SESSION_POLICY_QUERY_TIMEOUT_MS,
        values: statement.values,
      });
    }

    const [rows] = await connection.query({
      sql: MYSQL_SESSION_POLICY_READBACK_SQL,
      timeout: MYSQL_SESSION_POLICY_QUERY_TIMEOUT_MS,
    });
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      !isCanonicalMySqlSessionRow(rows[0], expectedDatabaseName)
    ) {
      throw new MySqlSessionPolicyError();
    }
  } catch {
    throw new MySqlSessionPolicyError();
  }
}
