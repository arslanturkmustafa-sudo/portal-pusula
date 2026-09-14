import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type FinanceAccountType = "bank" | "cash";
export type FinanceAccountStatus = "active" | "inactive";
export type FinanceTransactionType = "expense" | "income" | "transfer";
export type FinanceLedgerSide = "inflow" | "outflow";

export class FinanceLedgerIntegrityError extends Error {
  constructor() {
    super("Finance ledger reconciliation failed.");
    this.name = "FinanceLedgerIntegrityError";
  }
}

export type FinanceAccountRecord = Readonly<{
  accountType: FinanceAccountType;
  bankName: string | null;
  clientOperationKey: string;
  createdAtUtc: string;
  currency: "TRY";
  displayName: string;
  id: string;
  openingBalanceAmount: string;
  status: FinanceAccountStatus;
  updatedAtUtc: string;
  version: number;
}>;

export type FinanceAccountBalanceRecord = FinanceAccountRecord &
  Readonly<{ balanceAmount: string }>;

export type FinanceTransactionRecord = Readonly<{
  amount: string;
  clientOperationKey: string;
  createdAtUtc: string;
  currency: "TRY";
  description: string;
  id: string;
  occurredOn: string;
  reversalOfId: string | null;
  reversalReason: string | null;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  transactionType: FinanceTransactionType;
}>;

export type FinanceTransactionOverviewRecord = FinanceTransactionRecord &
  Readonly<{
    reversed: boolean;
    sourceAccountName: string | null;
    targetAccountName: string | null;
  }>;

export type NewFinanceLedgerEntry = Readonly<{
  accountId: string;
  amount: string;
  createdAtUtc: string;
  currency: "TRY";
  entrySide: FinanceLedgerSide;
  id: string;
  transactionId: string;
}>;

type AccountRow = RowDataPacket & {
  account_type: string;
  bank_name: string | null;
  client_operation_key: string;
  created_at_utc: string | Date;
  currency: string;
  display_name: string;
  id: string;
  opening_balance_amount: string;
  status: string;
  updated_at_utc: string | Date;
  version: number;
};

type AccountBalanceRow = AccountRow & { balance_amount: string };

type TransactionRow = RowDataPacket & {
  amount: string;
  client_operation_key: string;
  created_at_utc: string | Date;
  currency: string;
  description: string;
  id: string;
  occurred_on: string | Date;
  reversal_of_id: string | null;
  reversal_reason: string | null;
  source_account_id: string | null;
  target_account_id: string | null;
  transaction_type: string;
};

type TransactionOverviewRow = TransactionRow & {
  reversed: number;
  source_account_name: string | null;
  target_account_name: string | null;
};

type LedgerMismatchRow = RowDataPacket & { transaction_id: string };
type ManagedMovementRow = RowDataPacket & { id: string };

function canonicalDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function canonicalDateTime(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().replace("T", " ").replace("Z", "000")
    : value;
}

function accountType(value: string): FinanceAccountType {
  if (value !== "bank" && value !== "cash") {
    throw new Error("Finance account type is invalid.");
  }
  return value;
}

function accountStatus(value: string): FinanceAccountStatus {
  if (value !== "active" && value !== "inactive") {
    throw new Error("Finance account status is invalid.");
  }
  return value;
}

function transactionType(value: string): FinanceTransactionType {
  if (value !== "expense" && value !== "income" && value !== "transfer") {
    throw new Error("Finance transaction type is invalid.");
  }
  return value;
}

function validVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Finance account version is invalid.");
  }
  return value;
}

function mapAccount(row: AccountRow): FinanceAccountRecord {
  if (row.currency !== "TRY") throw new Error("Finance account currency is invalid.");
  return {
    accountType: accountType(row.account_type),
    bankName: row.bank_name,
    clientOperationKey: row.client_operation_key,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    currency: "TRY",
    displayName: row.display_name,
    id: row.id,
    openingBalanceAmount: row.opening_balance_amount,
    status: accountStatus(row.status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: validVersion(row.version),
  };
}

function mapAccountBalance(row: AccountBalanceRow): FinanceAccountBalanceRecord {
  return { ...mapAccount(row), balanceAmount: row.balance_amount };
}

function mapTransaction(row: TransactionRow): FinanceTransactionRecord {
  if (row.currency !== "TRY") {
    throw new Error("Finance transaction currency is invalid.");
  }
  return {
    amount: row.amount,
    clientOperationKey: row.client_operation_key,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    currency: "TRY",
    description: row.description,
    id: row.id,
    occurredOn: canonicalDate(row.occurred_on),
    reversalOfId: row.reversal_of_id,
    reversalReason: row.reversal_reason,
    sourceAccountId: row.source_account_id,
    targetAccountId: row.target_account_id,
    transactionType: transactionType(row.transaction_type),
  };
}

const ACCOUNT_COLUMNS = `
  id, client_operation_key, account_type, display_name, bank_name, currency,
  opening_balance_amount, status, version, created_at_utc, updated_at_utc`;

const ACCOUNT_BALANCE_COLUMNS = `
  a.id, a.client_operation_key, a.account_type, a.display_name, a.bank_name,
  a.currency, a.opening_balance_amount, a.status, a.version,
  a.created_at_utc, a.updated_at_utc,
  CAST(a.opening_balance_amount + COALESCE(SUM(
    CASE
      WHEN BINARY le.entry_side = BINARY 'inflow' THEN le.amount
      WHEN BINARY le.entry_side = BINARY 'outflow' THEN -le.amount
      ELSE 0
    END
  ), 0) AS DECIMAL(65,4)) AS balance_amount`;

const TRANSACTION_COLUMNS = `
  id, client_operation_key, transaction_type, occurred_on, description,
  amount, currency, source_account_id, target_account_id, reversal_of_id,
  reversal_reason, created_at_utc`;

const ACCOUNT_BALANCE_GROUP = `
  a.id, a.client_operation_key, a.account_type, a.display_name, a.bank_name,
  a.currency, a.opening_balance_amount, a.status, a.version,
  a.created_at_utc, a.updated_at_utc`;

export async function assertFinanceLedgerReconciled(
  connection: PoolConnection,
  accountId?: string,
): Promise<void> {
  const scope =
    accountId === undefined
      ? ""
      : `WHERE (
          BINARY t.source_account_id = BINARY ?
          OR BINARY t.target_account_id = BINARY ?
          OR BINARY le.account_id = BINARY ?
        )`;
  const parameters = accountId === undefined ? [] : [accountId, accountId, accountId];
  const [rows] = await connection.execute<LedgerMismatchRow[]>(
    `SELECT t.id AS transaction_id
       FROM finance_transaction t
       LEFT JOIN finance_ledger_entry le ON le.transaction_id = t.id
       ${scope}
      GROUP BY t.id, t.transaction_type, t.amount, t.currency,
               t.source_account_id, t.target_account_id
     HAVING COUNT(le.id) <>
              CASE WHEN BINARY t.transaction_type = BINARY 'transfer' THEN 2 ELSE 1 END
         OR SUM(
              CASE
                WHEN le.id IS NULL THEN 0
                WHEN le.amount <> t.amount
                  OR BINARY le.currency <> BINARY t.currency THEN 1
                ELSE 0
              END
            ) <> 0
         OR SUM(
              CASE
                WHEN BINARY t.transaction_type = BINARY 'income'
                  AND BINARY le.entry_side = BINARY 'inflow'
                  AND BINARY le.account_id = BINARY t.target_account_id THEN 1
                WHEN BINARY t.transaction_type = BINARY 'expense'
                  AND BINARY le.entry_side = BINARY 'outflow'
                  AND BINARY le.account_id = BINARY t.source_account_id THEN 1
                WHEN BINARY t.transaction_type = BINARY 'transfer'
                  AND BINARY le.entry_side = BINARY 'outflow'
                  AND BINARY le.account_id = BINARY t.source_account_id THEN 1
                WHEN BINARY t.transaction_type = BINARY 'transfer'
                  AND BINARY le.entry_side = BINARY 'inflow'
                  AND BINARY le.account_id = BINARY t.target_account_id THEN 1
                ELSE 0
              END
            ) <>
              CASE WHEN BINARY t.transaction_type = BINARY 'transfer' THEN 2 ELSE 1 END
      LIMIT 1`,
    parameters,
  );
  if (rows.length > 0) throw new FinanceLedgerIntegrityError();

  const reversalScope =
    accountId === undefined
      ? ""
      : `AND (
          BINARY reversal.source_account_id = BINARY ?
          OR BINARY reversal.target_account_id = BINARY ?
          OR BINARY original.source_account_id = BINARY ?
          OR BINARY original.target_account_id = BINARY ?
        )`;
  const reversalParameters =
    accountId === undefined
      ? []
      : [accountId, accountId, accountId, accountId];
  const [invalidReversals] = await connection.execute<LedgerMismatchRow[]>(
    `SELECT reversal.id AS transaction_id
       FROM finance_transaction reversal
       LEFT JOIN finance_transaction original
         ON original.id = reversal.reversal_of_id
      WHERE reversal.reversal_of_id IS NOT NULL
        ${reversalScope}
        AND (
          original.id IS NULL
          OR original.reversal_of_id IS NOT NULL
          OR reversal.amount <> original.amount
          OR BINARY reversal.currency <> BINARY original.currency
          OR NOT (
            (
              BINARY original.transaction_type = BINARY 'income'
              AND BINARY reversal.transaction_type = BINARY 'expense'
              AND BINARY reversal.source_account_id = BINARY original.target_account_id
              AND reversal.target_account_id IS NULL
            )
            OR (
              BINARY original.transaction_type = BINARY 'expense'
              AND BINARY reversal.transaction_type = BINARY 'income'
              AND reversal.source_account_id IS NULL
              AND BINARY reversal.target_account_id = BINARY original.source_account_id
            )
            OR (
              BINARY original.transaction_type = BINARY 'transfer'
              AND BINARY reversal.transaction_type = BINARY 'transfer'
              AND BINARY reversal.source_account_id = BINARY original.target_account_id
              AND BINARY reversal.target_account_id = BINARY original.source_account_id
            )
          )
        )
      LIMIT 1`,
    reversalParameters,
  );
  if (invalidReversals.length > 0) throw new FinanceLedgerIntegrityError();
}

export async function listFinanceAccountBalanceRecords(
  connection: PoolConnection,
): Promise<readonly FinanceAccountBalanceRecord[]> {
  await assertFinanceLedgerReconciled(connection);
  const [rows] = await connection.execute<AccountBalanceRow[]>(
    `SELECT ${ACCOUNT_BALANCE_COLUMNS}
       FROM finance_account a
       LEFT JOIN finance_ledger_entry le ON le.account_id = a.id
      GROUP BY ${ACCOUNT_BALANCE_GROUP}
      ORDER BY FIELD(a.status, 'active', 'inactive'),
               FIELD(a.account_type, 'bank', 'cash'),
               a.display_name ASC, a.id ASC`,
  );
  return rows.map(mapAccountBalance);
}

export async function findFinanceAccountBalanceRecord(
  connection: PoolConnection,
  id: string,
): Promise<FinanceAccountBalanceRecord | null> {
  await assertFinanceLedgerReconciled(connection, id);
  const [rows] = await connection.execute<AccountBalanceRow[]>(
    `SELECT ${ACCOUNT_BALANCE_COLUMNS}
       FROM finance_account a
       LEFT JOIN finance_ledger_entry le ON le.account_id = a.id
      WHERE a.id = ?
      GROUP BY ${ACCOUNT_BALANCE_GROUP}`,
    [id],
  );
  return rows[0] ? mapAccountBalance(rows[0]) : null;
}

export async function listRecentFinanceTransactionRecords(
  connection: PoolConnection,
): Promise<readonly FinanceTransactionOverviewRecord[]> {
  const [rows] = await connection.execute<TransactionOverviewRow[]>(
    `SELECT
       t.id, t.client_operation_key, t.transaction_type, t.occurred_on,
       t.description, t.amount, t.currency, t.source_account_id,
       t.target_account_id, t.reversal_of_id, t.reversal_reason,
       t.created_at_utc,
       source_account.display_name AS source_account_name,
       target_account.display_name AS target_account_name,
       CASE WHEN reversal.id IS NULL THEN 0 ELSE 1 END AS reversed
       FROM finance_transaction t
       LEFT JOIN finance_account source_account ON source_account.id = t.source_account_id
       LEFT JOIN finance_account target_account ON target_account.id = t.target_account_id
       LEFT JOIN finance_transaction reversal ON reversal.reversal_of_id = t.id
      ORDER BY t.occurred_on DESC, t.created_at_utc DESC, t.id DESC
      LIMIT 12`,
  );
  return rows.map((row) => ({
    ...mapTransaction(row),
    reversed: row.reversed === 1,
    sourceAccountName: row.source_account_name,
    targetAccountName: row.target_account_name,
  }));
}

export async function findFinanceAccountForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<FinanceAccountRecord | null> {
  const [rows] = await connection.execute<AccountRow[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM finance_account WHERE id = ? FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function lockFinanceAccounts(
  connection: PoolConnection,
  ids: readonly string[],
): Promise<readonly FinanceAccountRecord[]> {
  const uniqueIds = [...new Set(ids)].sort();
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<AccountRow[]>(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM finance_account
      WHERE id IN (${placeholders})
      ORDER BY id ASC
      FOR UPDATE`,
    uniqueIds,
  );
  return rows.map(mapAccount);
}

export async function findFinanceAccountByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<FinanceAccountRecord | null> {
  const [rows] = await connection.execute<AccountRow[]>(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM finance_account
      WHERE client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function insertFinanceAccountRecordIdempotently(
  connection: PoolConnection,
  account: FinanceAccountRecord,
): Promise<FinanceAccountRecord> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO finance_account
       (id, client_operation_key, account_type, display_name, bank_name,
        currency, opening_balance_amount, status, version, created_at_utc,
        updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      account.id,
      account.clientOperationKey,
      account.accountType,
      account.displayName,
      account.bankName,
      account.currency,
      account.openingBalanceAmount,
      account.status,
      account.version,
      account.createdAtUtc,
      account.updatedAtUtc,
    ],
  );
  const stored = await findFinanceAccountByOperationKeyForUpdate(
    connection,
    account.clientOperationKey,
  );
  if (!stored) throw new Error("Finance account insert failed.");
  return stored;
}

export async function updateFinanceAccountRecord(
  connection: PoolConnection,
  account: FinanceAccountRecord,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE finance_account
        SET account_type = ?, display_name = ?, bank_name = ?, status = ?,
            version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      account.accountType,
      account.displayName,
      account.bankName,
      account.status,
      account.version,
      account.updatedAtUtc,
      account.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}

export async function findFinanceTransactionForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<FinanceTransactionRecord | null> {
  const [rows] = await connection.execute<TransactionRow[]>(
    `SELECT ${TRANSACTION_COLUMNS}
       FROM finance_transaction
      WHERE id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapTransaction(rows[0]) : null;
}

export async function findExpenseByFinanceTransactionForUpdate(
  connection: PoolConnection,
  financeTransactionId: string,
): Promise<string | null> {
  const [rows] = await connection.execute<ManagedMovementRow[]>(
    `SELECT id
       FROM expense
      WHERE finance_transaction_id = ?
      FOR UPDATE`,
    [financeTransactionId],
  );
  return rows[0]?.id ?? null;
}

export async function findReceivableCollectionByFinanceTransactionForUpdate(
  connection: PoolConnection,
  financeTransactionId: string,
): Promise<string | null> {
  const [rows] = await connection.execute<ManagedMovementRow[]>(
    `SELECT id
       FROM receivable_collection
      WHERE finance_transaction_id = ?
      FOR UPDATE`,
    [financeTransactionId],
  );
  return rows[0]?.id ?? null;
}

export async function findCardInstallmentByFinanceTransactionForUpdate(
  connection: PoolConnection,
  financeTransactionId: string,
): Promise<string | null> {
  const [legacyRows] = await connection.execute<ManagedMovementRow[]>(
    `SELECT id
       FROM credit_card_installment
      WHERE finance_transaction_id = ?
      FOR UPDATE`,
    [financeTransactionId],
  );
  if (legacyRows[0]) return legacyRows[0].id;

  const [paymentRows] = await connection.execute<ManagedMovementRow[]>(
    `SELECT installment_id AS id
       FROM credit_card_installment_payment
      WHERE finance_transaction_id = ?
      FOR UPDATE`,
    [financeTransactionId],
  );
  return paymentRows[0]?.id ?? null;
}

export async function findFinanceTransactionByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<FinanceTransactionRecord | null> {
  const [rows] = await connection.execute<TransactionRow[]>(
    `SELECT ${TRANSACTION_COLUMNS}
       FROM finance_transaction
      WHERE client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapTransaction(rows[0]) : null;
}

export async function findFinanceTransactionReversalForUpdate(
  connection: PoolConnection,
  originalId: string,
): Promise<FinanceTransactionRecord | null> {
  const [rows] = await connection.execute<TransactionRow[]>(
    `SELECT ${TRANSACTION_COLUMNS}
       FROM finance_transaction
      WHERE reversal_of_id = ?
      FOR UPDATE`,
    [originalId],
  );
  return rows[0] ? mapTransaction(rows[0]) : null;
}

export async function insertFinanceTransactionRecordIdempotently(
  connection: PoolConnection,
  transaction: FinanceTransactionRecord,
): Promise<FinanceTransactionRecord> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO finance_transaction
       (id, client_operation_key, transaction_type, occurred_on, description,
        amount, currency, source_account_id, target_account_id,
        reversal_of_id, reversal_reason, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      transaction.id,
      transaction.clientOperationKey,
      transaction.transactionType,
      transaction.occurredOn,
      transaction.description,
      transaction.amount,
      transaction.currency,
      transaction.sourceAccountId,
      transaction.targetAccountId,
      transaction.reversalOfId,
      transaction.reversalReason,
      transaction.createdAtUtc,
    ],
  );
  const byOperation = await findFinanceTransactionByOperationKeyForUpdate(
    connection,
    transaction.clientOperationKey,
  );
  if (byOperation) return byOperation;
  if (transaction.reversalOfId !== null) {
    const byReversal = await findFinanceTransactionReversalForUpdate(
      connection,
      transaction.reversalOfId,
    );
    if (byReversal) return byReversal;
  }
  throw new Error("Finance transaction insert failed.");
}

export async function insertFinanceLedgerEntries(
  connection: PoolConnection,
  entries: readonly NewFinanceLedgerEntry[],
): Promise<void> {
  for (const entry of entries) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO finance_ledger_entry
         (id, transaction_id, account_id, entry_side, amount, currency,
          created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.transactionId,
        entry.accountId,
        entry.entrySide,
        entry.amount,
        entry.currency,
        entry.createdAtUtc,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new Error("Finance ledger append failed.");
    }
  }
}
