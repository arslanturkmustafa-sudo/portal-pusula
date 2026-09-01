import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export const MYSQL_CANONICAL_SQL_MODE =
  "STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION";
export const MYSQL_SESSION_QUERY_TIMEOUT_MS = 2_000;

export const MYSQL_SESSION_SETUP_SQL = Object.freeze([
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
    values: Object.freeze([MYSQL_CANONICAL_SQL_MODE]),
  }),
]);

export const MYSQL_SESSION_VERIFY_SQL = `SELECT
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

type MySqlSessionContractRow = RowDataPacket & {
  autocommit?: unknown;
  character_set_client?: unknown;
  character_set_connection?: unknown;
  character_set_results?: unknown;
  check_constraint_checks?: unknown;
  collation_connection?: unknown;
  current_database?: unknown;
  default_storage_engine?: unknown;
  foreign_key_checks?: unknown;
  sql_mode?: unknown;
  time_zone?: unknown;
  unique_checks?: unknown;
};

type MySqlSessionConnection = Pick<PoolConnection, "query">;

const expectedDatabaseByPool = new WeakMap<object, string>();

export class MySqlSessionContractError extends Error {
  constructor() {
    super("Database session contract could not be established.");
    this.name = "MySqlSessionContractError";
  }
}

export function registerMySqlPoolDatabase(
  pool: object,
  expectedDatabaseName: string,
): void {
  const registeredDatabase = expectedDatabaseByPool.get(pool);
  if (
    expectedDatabaseName.length === 0 ||
    (registeredDatabase !== undefined &&
      registeredDatabase !== expectedDatabaseName)
  ) {
    throw new MySqlSessionContractError();
  }

  expectedDatabaseByPool.set(pool, expectedDatabaseName);
}

export function registeredMySqlPoolDatabase(pool: object): string {
  const expectedDatabaseName = expectedDatabaseByPool.get(pool);
  if (expectedDatabaseName === undefined) {
    throw new MySqlSessionContractError();
  }

  return expectedDatabaseName;
}

function isEnabledFlag(value: unknown): boolean {
  return value === 1 || value === "1";
}

function isExpectedSession(
  row: MySqlSessionContractRow,
  expectedDatabaseName: string,
): boolean {
  return (
    row.current_database === expectedDatabaseName &&
    row.character_set_client === "utf8mb4" &&
    row.character_set_connection === "utf8mb4" &&
    row.character_set_results === "utf8mb4" &&
    row.collation_connection === "utf8mb4_unicode_ci" &&
    row.time_zone === "+00:00" &&
    isEnabledFlag(row.autocommit) &&
    isEnabledFlag(row.check_constraint_checks) &&
    isEnabledFlag(row.foreign_key_checks) &&
    isEnabledFlag(row.unique_checks) &&
    row.default_storage_engine === "InnoDB" &&
    row.sql_mode === MYSQL_CANONICAL_SQL_MODE
  );
}

export async function configureAndVerifyMySqlSession(
  connection: MySqlSessionConnection,
  expectedDatabaseName: string,
): Promise<void> {
  try {
    if (
      typeof expectedDatabaseName !== "string" ||
      expectedDatabaseName.length === 0
    ) {
      throw new MySqlSessionContractError();
    }

    for (const statement of MYSQL_SESSION_SETUP_SQL) {
      await connection.query({
        sql: statement.sql,
        timeout: MYSQL_SESSION_QUERY_TIMEOUT_MS,
        values: [...statement.values],
      });
    }

    const [rows] = await connection.query<MySqlSessionContractRow[]>(
      {
        sql: MYSQL_SESSION_VERIFY_SQL,
        timeout: MYSQL_SESSION_QUERY_TIMEOUT_MS,
      },
    );
    if (
      rows.length !== 1 ||
      !rows[0] ||
      !isExpectedSession(rows[0], expectedDatabaseName)
    ) {
      throw new MySqlSessionContractError();
    }
  } catch {
    throw new MySqlSessionContractError();
  }
}
