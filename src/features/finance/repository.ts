import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { ContractStatus, VatMode } from "@/features/contracts/repository";

export type ReceivableSourceType = "contract_month" | "opening_balance";

export type ReceivableRecord = Readonly<{
  collectedAmount: string;
  contractId: string | null;
  createdAtUtc: string;
  currency: "TRY";
  customerId: string;
  customerName: string;
  description: string;
  dueOn: string;
  id: string;
  netAmount: string;
  periodMonth: string | null;
  projectId: string | null;
  projectName: string | null;
  projectShortCode: string | null;
  sourceType: ReceivableSourceType;
  totalAmount: string;
  updatedAtUtc: string;
  vatAmount: string;
}>;

export type NewReceivableRecord = Omit<
  ReceivableRecord,
  | "collectedAmount"
  | "customerName"
  | "projectId"
  | "projectName"
  | "projectShortCode"
> &
  Readonly<{ clientOperationKey: string | null; projectId: string }>;

export type ReceivableCollection = Readonly<{
  amount: string;
  clientOperationKey: string;
  collectedOn: string;
  createdAtUtc: string;
  id: string;
  note: string | null;
  receivableId: string;
}>;

export type FinanceReceivableSnapshot = Readonly<{
  collectedAmountInRange: string;
  receivables: readonly ReceivableRecord[];
}>;

export type FinanceContractTerms = Readonly<{
  customerId: string;
  endsOn: string;
  id: string;
  monthlyFeeAmount: string;
  paymentDay: number;
  projectId: string | null;
  startsOn: string;
  status: ContractStatus;
  vatMode: VatMode;
  vatRate: string;
}>;

type ReceivableRow = RowDataPacket & {
  collected_amount: string;
  contract_id: string | null;
  created_at_utc: string | Date;
  currency: string;
  customer_id: string;
  customer_name: string;
  description: string;
  due_on: string | Date;
  id: string;
  net_amount: string;
  period_month: string | Date | null;
  project_id: string | null;
  project_name: string | null;
  project_short_code: string | null;
  source_type: string;
  total_amount: string;
  updated_at_utc: string | Date;
  vat_amount: string;
};

type ReceivableSnapshotRow = ReceivableRow & {
  collected_in_range_amount: string;
};

type CollectionRow = RowDataPacket & {
  amount: string;
  client_operation_key: string;
  collected_on: string | Date;
  created_at_utc: string | Date;
  id: string;
  note: string | null;
  receivable_id: string;
};

type ContractTermsRow = RowDataPacket & {
  customer_id: string;
  ends_on: string | Date;
  id: string;
  monthly_fee_amount: string;
  payment_day: number;
  project_id: string | null;
  starts_on: string | Date;
  status: string;
  vat_mode: string;
  vat_rate: string;
};

function canonicalDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function mapReceivable(row: ReceivableRow): ReceivableRecord {
  if (
    row.source_type !== "contract_month" &&
    row.source_type !== "opening_balance"
  ) {
    throw new Error("Receivable source type is invalid.");
  }
  if (row.currency !== "TRY") throw new Error("Receivable currency is invalid.");

  return {
    collectedAmount: row.collected_amount,
    contractId: row.contract_id,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    currency: "TRY",
    customerId: row.customer_id,
    customerName: row.customer_name,
    description: row.description,
    dueOn: canonicalDate(row.due_on),
    id: row.id,
    netAmount: row.net_amount,
    periodMonth:
      row.period_month === null
        ? null
        : canonicalDate(row.period_month).slice(0, 7),
    projectId: row.project_id,
    projectName: row.project_name,
    projectShortCode: row.project_short_code,
    sourceType: row.source_type,
    totalAmount: row.total_amount,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    vatAmount: row.vat_amount,
  };
}

function mapCollection(row: CollectionRow): ReceivableCollection {
  return {
    amount: row.amount,
    clientOperationKey: row.client_operation_key,
    collectedOn: canonicalDate(row.collected_on),
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    id: row.id,
    note: row.note,
    receivableId: row.receivable_id,
  };
}

const RECEIVABLE_COLUMNS = `
  r.id, r.customer_id, c.display_name AS customer_name, r.project_id,
  p.display_name AS project_name, p.short_code AS project_short_code, r.contract_id,
  r.source_type, r.period_month, r.due_on, r.description,
  r.net_amount, r.vat_amount, r.total_amount, r.currency,
  r.created_at_utc, r.updated_at_utc,
  COALESCE((
    SELECT SUM(rc.amount)
      FROM receivable_collection rc
     WHERE rc.receivable_id = r.id
  ), 0.0000) AS collected_amount`;

export async function listReceivableRecords(
  connection: PoolConnection,
  startOn: string,
  nextStartOn: string,
  projectId?: string,
): Promise<FinanceReceivableSnapshot> {
  const collectionProjectFilter =
    projectId === undefined ? "" : "\n            AND collected_r.project_id = ?";
  const receivableProjectFilter =
    projectId === undefined ? "" : "\n      WHERE r.project_id = ?";
  const parameters =
    projectId === undefined
      ? [startOn, nextStartOn]
      : [startOn, nextStartOn, projectId, projectId];
  const [rows] = await connection.execute<ReceivableSnapshotRow[]>(
    `SELECT ${RECEIVABLE_COLUMNS},
            month_collection.collected_in_range_amount
       FROM receivable r
       JOIN customer c ON c.id = r.customer_id
       LEFT JOIN project p ON p.id = r.project_id
       CROSS JOIN (
         SELECT COALESCE(SUM(rc.amount), 0.0000) AS collected_in_range_amount
           FROM receivable_collection rc
           JOIN receivable collected_r ON collected_r.id = rc.receivable_id
          WHERE rc.collected_on >= ? AND rc.collected_on < ?${collectionProjectFilter}
       ) month_collection
       ${receivableProjectFilter}
      ORDER BY r.due_on ASC, c.display_name ASC, r.id ASC`,
    parameters,
  );
  return {
    collectedAmountInRange:
      rows[0]?.collected_in_range_amount ?? "0.0000",
    receivables: rows.map(mapReceivable),
  };
}

export async function findReceivableForUpdate(
  connection: PoolConnection,
  receivableId: string,
): Promise<ReceivableRecord | null> {
  const [rows] = await connection.execute<ReceivableRow[]>(
    `SELECT ${RECEIVABLE_COLUMNS}
       FROM receivable r
       JOIN customer c ON c.id = r.customer_id
       LEFT JOIN project p ON p.id = r.project_id
      WHERE r.id = ?
      FOR UPDATE`,
    [receivableId],
  );
  return rows[0] ? mapReceivable(rows[0]) : null;
}

export async function findGeneratedReceivableForUpdate(
  connection: PoolConnection,
  contractId: string,
  periodMonth: string,
): Promise<ReceivableRecord | null> {
  const [rows] = await connection.execute<ReceivableRow[]>(
    `SELECT ${RECEIVABLE_COLUMNS}
       FROM receivable r
       JOIN customer c ON c.id = r.customer_id
       LEFT JOIN project p ON p.id = r.project_id
      WHERE r.contract_id = ?
        AND r.source_type = 'contract_month'
        AND r.period_month = ?
      FOR UPDATE`,
    [contractId, periodMonth],
  );
  return rows[0] ? mapReceivable(rows[0]) : null;
}

export async function findOpeningBalanceByClientOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<ReceivableRecord | null> {
  const [rows] = await connection.execute<ReceivableRow[]>(
    `SELECT ${RECEIVABLE_COLUMNS}
       FROM receivable r
       JOIN customer c ON c.id = r.customer_id
       LEFT JOIN project p ON p.id = r.project_id
      WHERE r.source_type = 'opening_balance'
        AND r.client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapReceivable(rows[0]) : null;
}

export async function findCollectionByClientOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<ReceivableCollection | null> {
  const [rows] = await connection.execute<CollectionRow[]>(
    `SELECT id, client_operation_key, receivable_id, amount, collected_on,
            note, created_at_utc
       FROM receivable_collection
      WHERE client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapCollection(rows[0]) : null;
}

export async function findFinanceContractForUpdate(
  connection: PoolConnection,
  contractId: string,
): Promise<FinanceContractTerms | null> {
  const [rows] = await connection.execute<ContractTermsRow[]>(
    `SELECT id, customer_id, project_id, status, starts_on, ends_on,
            monthly_fee_amount, vat_mode, vat_rate, payment_day
       FROM consulting_contract
      WHERE id = ?
      FOR UPDATE`,
    [contractId],
  );
  const row = rows[0];
  if (!row) return null;
  if (
    row.status !== "draft" &&
    row.status !== "active" &&
    row.status !== "closed"
  ) {
    throw new Error("Contract status is invalid.");
  }
  if (
    row.vat_mode !== "exempt" &&
    row.vat_mode !== "exclusive" &&
    row.vat_mode !== "inclusive"
  ) {
    throw new Error("Contract VAT mode is invalid.");
  }
  return {
    customerId: row.customer_id,
    endsOn: canonicalDate(row.ends_on),
    id: row.id,
    monthlyFeeAmount: row.monthly_fee_amount,
    paymentDay: row.payment_day,
    projectId: row.project_id,
    startsOn: canonicalDate(row.starts_on),
    status: row.status,
    vatMode: row.vat_mode,
    vatRate: row.vat_rate,
  };
}

export async function insertReceivableRecord(
  connection: PoolConnection,
  receivable: NewReceivableRecord,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO receivable
       (id, client_operation_key, customer_id, project_id, contract_id, source_type,
        period_month, due_on,
        description, net_amount, vat_amount, total_amount, currency,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      receivable.id,
      receivable.clientOperationKey,
      receivable.customerId,
      receivable.projectId,
      receivable.contractId,
      receivable.sourceType,
      receivable.periodMonth === null
        ? null
        : `${receivable.periodMonth}-01`,
      receivable.dueOn,
      receivable.description,
      receivable.netAmount,
      receivable.vatAmount,
      receivable.totalAmount,
      receivable.currency,
      receivable.createdAtUtc,
      receivable.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Receivable insert failed.");
}

export async function insertOpeningBalanceRecordIdempotently(
  connection: PoolConnection,
  receivable: NewReceivableRecord,
): Promise<ReceivableRecord> {
  if (receivable.clientOperationKey === null) {
    throw new Error("Opening balance client operation key is required.");
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO receivable
       (id, client_operation_key, customer_id, project_id, contract_id, source_type,
        period_month, due_on, description, net_amount, vat_amount,
        total_amount, currency, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      receivable.id,
      receivable.clientOperationKey,
      receivable.customerId,
      receivable.projectId,
      receivable.contractId,
      receivable.sourceType,
      receivable.periodMonth === null
        ? null
        : `${receivable.periodMonth}-01`,
      receivable.dueOn,
      receivable.description,
      receivable.netAmount,
      receivable.vatAmount,
      receivable.totalAmount,
      receivable.currency,
      receivable.createdAtUtc,
      receivable.updatedAtUtc,
    ],
  );
  const persisted = await findOpeningBalanceByClientOperationKeyForUpdate(
    connection,
    receivable.clientOperationKey,
  );
  if (!persisted) throw new Error("Opening balance insert failed.");
  return persisted;
}

export async function insertCollectionRecordIdempotently(
  connection: PoolConnection,
  collection: ReceivableCollection,
): Promise<ReceivableCollection> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO receivable_collection
       (id, client_operation_key, receivable_id, amount, collected_on, note,
        created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      collection.id,
      collection.clientOperationKey,
      collection.receivableId,
      collection.amount,
      collection.collectedOn,
      collection.note,
      collection.createdAtUtc,
    ],
  );
  const persisted = await findCollectionByClientOperationKeyForUpdate(
    connection,
    collection.clientOperationKey,
  );
  if (!persisted) throw new Error("Collection insert failed.");
  return persisted;
}
