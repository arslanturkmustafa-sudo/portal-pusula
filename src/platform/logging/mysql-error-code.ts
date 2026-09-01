export const UNKNOWN_MYSQL_ERROR_CODE = "UNKNOWN_DATABASE_ERROR" as const;

const SAFE_MYSQL_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ER_ACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_BAD_FIELD_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_NO_SUCH_TABLE",
  "ER_TABLEACCESS_DENIED_ERROR",
]);

export function safeMySqlErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return UNKNOWN_MYSQL_ERROR_CODE;
  }

  try {
    const code = "code" in error ? error.code : undefined;
    return typeof code === "string" && SAFE_MYSQL_ERROR_CODES.has(code)
      ? code
      : UNKNOWN_MYSQL_ERROR_CODE;
  } catch {
    return UNKNOWN_MYSQL_ERROR_CODE;
  }
}
