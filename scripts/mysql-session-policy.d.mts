import type { PoolConnection } from "mysql2/promise";

export const MYSQL_SESSION_SQL_MODE: string;
export const MYSQL_SESSION_CHARACTER_SET: string;
export const MYSQL_SESSION_COLLATION: string;
export const MYSQL_SESSION_TIME_ZONE: string;
export const MYSQL_SESSION_STORAGE_ENGINE: string;
export const MYSQL_SESSION_POLICY_QUERY_TIMEOUT_MS: number;

export const MYSQL_SESSION_POLICY_SET_STATEMENTS: readonly Readonly<{
  sql: string;
  values: readonly string[];
}>[];

export const MYSQL_SESSION_POLICY_READBACK_SQL: string;

export class MySqlSessionPolicyError extends Error {}

export function isCanonicalMySqlSessionRow(
  row: unknown,
  expectedDatabaseName: string,
): boolean;

export function applyMySqlSessionPolicy(
  connection: Pick<PoolConnection, "query">,
  expectedDatabaseName: string,
): Promise<void>;
