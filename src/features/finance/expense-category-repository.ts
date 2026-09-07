import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type ExpenseCategoryStatus = "active" | "inactive";

export type ExpenseCategoryRecord = Readonly<{
  clientOperationKey: string;
  code: string;
  createdAtUtc: string;
  displayName: string;
  id: string;
  isSystem: boolean;
  status: ExpenseCategoryStatus;
  updatedAtUtc: string;
  version: number;
}>;

type ExpenseCategoryRow = RowDataPacket & {
  client_operation_key: string;
  code: string;
  created_at_utc: string | Date;
  display_name: string;
  id: string;
  is_system: number;
  status: string;
  updated_at_utc: string | Date;
  version: number;
};

const COLUMNS = `
  id, code, client_operation_key, display_name, is_system, status, version,
  created_at_utc, updated_at_utc`;

function canonicalDateTime(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().replace("T", " ").replace("Z", "000")
    : value;
}

function mapExpenseCategory(row: ExpenseCategoryRow): ExpenseCategoryRecord {
  if (row.status !== "active" && row.status !== "inactive") {
    throw new Error("Expense category status is invalid.");
  }
  if (row.is_system !== 0 && row.is_system !== 1) {
    throw new Error("Expense category system flag is invalid.");
  }
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new Error("Expense category version is invalid.");
  }
  return {
    clientOperationKey: row.client_operation_key,
    code: row.code,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    displayName: row.display_name,
    id: row.id,
    isSystem: row.is_system === 1,
    status: row.status,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: row.version,
  };
}

export async function listExpenseCategoryRecords(
  connection: PoolConnection,
): Promise<readonly ExpenseCategoryRecord[]> {
  const [rows] = await connection.execute<ExpenseCategoryRow[]>(
    `SELECT ${COLUMNS}
       FROM expense_category
      WHERE BINARY status = BINARY 'active'
      ORDER BY is_system DESC, display_name ASC, code ASC`,
  );
  return rows.map(mapExpenseCategory);
}

export async function findExpenseCategoryByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<ExpenseCategoryRecord | null> {
  const [rows] = await connection.execute<ExpenseCategoryRow[]>(
    `SELECT ${COLUMNS}
       FROM expense_category
      WHERE client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapExpenseCategory(rows[0]) : null;
}

export async function findExpenseCategoryByDisplayNameForUpdate(
  connection: PoolConnection,
  displayName: string,
): Promise<ExpenseCategoryRecord | null> {
  const [rows] = await connection.execute<ExpenseCategoryRow[]>(
    `SELECT ${COLUMNS}
       FROM expense_category
      WHERE display_name = ?
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE`,
    [displayName],
  );
  return rows[0] ? mapExpenseCategory(rows[0]) : null;
}

export async function findActiveExpenseCategoryByCodeForUpdate(
  connection: PoolConnection,
  code: string,
): Promise<ExpenseCategoryRecord | null> {
  const [rows] = await connection.execute<ExpenseCategoryRow[]>(
    `SELECT ${COLUMNS}
       FROM expense_category
      WHERE code = ? AND BINARY status = BINARY 'active'
      FOR UPDATE`,
    [code],
  );
  return rows[0] ? mapExpenseCategory(rows[0]) : null;
}

export async function insertExpenseCategoryRecordIdempotently(
  connection: PoolConnection,
  category: ExpenseCategoryRecord,
): Promise<ExpenseCategoryRecord> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO expense_category
       (id, code, client_operation_key, display_name, is_system, status,
        version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      category.id,
      category.code,
      category.clientOperationKey,
      category.displayName,
      category.isSystem ? 1 : 0,
      category.status,
      category.version,
      category.createdAtUtc,
      category.updatedAtUtc,
    ],
  );
  const stored = await findExpenseCategoryByOperationKeyForUpdate(
    connection,
    category.clientOperationKey,
  );
  if (!stored) throw new Error("Expense category insert failed.");
  return stored;
}
