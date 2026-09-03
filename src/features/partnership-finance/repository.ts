import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { PartnershipListFilter } from "./validation";

export class ContributionMonthCollisionError extends Error {
  constructor() {
    super("A contribution already exists for this project month.");
    this.name = "ContributionMonthCollisionError";
  }
}

export type CommissionTransactionType = "sale" | "rental";
export type CommissionContributionMode =
  | "partner_only"
  | "user_one_side"
  | "user_both";
export type CommissionStatus =
  | "expected"
  | "agency_collected"
  | "paid"
  | "cancelled";
export type ContributionStatus =
  | "expected"
  | "partial"
  | "received"
  | "cancelled";

export type PartnershipCommission = Readonly<{
  agencyCollectedOn: string | null;
  clientOperationKey: string;
  closedOn: string;
  commissionBasisAmount: string;
  contributionMode: CommissionContributionMode;
  createdAtUtc: string;
  description: string;
  id: string;
  note: string | null;
  paidOn: string | null;
  projectId: string;
  projectName: string;
  projectShortCode: string;
  shareAmount: string;
  shareRate: string;
  status: CommissionStatus;
  transactionType: CommissionTransactionType;
  updatedAtUtc: string;
  version: number;
}>;

export type PartnershipContribution = Readonly<{
  clientOperationKey: string;
  contributionMonth: string;
  createdAtUtc: string;
  description: string;
  dueOn: string;
  expectedAmount: string;
  id: string;
  note: string | null;
  projectId: string;
  projectName: string;
  projectShortCode: string;
  receivedAmount: string;
  receivedOn: string | null;
  status: ContributionStatus;
  updatedAtUtc: string;
  version: number;
}>;

export type PartnershipContributionReceipt = Readonly<{
  amount: string;
  clientOperationKey: string;
  contributionId: string;
  createdAtUtc: string;
  id: string;
  note: string | null;
  receivedOn: string;
}>;

type CommissionRow = RowDataPacket & {
  agency_collected_on: string | Date | null;
  client_operation_key: string;
  closed_on: string | Date;
  commission_basis_amount: string;
  contribution_mode: string;
  created_at_utc: string | Date;
  description: string;
  id: string;
  note: string | null;
  paid_on: string | Date | null;
  project_id: string;
  project_name: string;
  project_short_code: string;
  share_amount: string;
  share_rate: string;
  status: string;
  transaction_type: string;
  updated_at_utc: string | Date;
  version: number;
};

type ContributionRow = RowDataPacket & {
  client_operation_key: string;
  contribution_month: string | Date;
  created_at_utc: string | Date;
  description: string;
  due_on: string | Date;
  expected_amount: string;
  id: string;
  note: string | null;
  project_id: string;
  project_name: string;
  project_short_code: string;
  received_amount: string;
  received_on: string | Date | null;
  status: string;
  updated_at_utc: string | Date;
  version: number;
};

type ContributionReceiptRow = RowDataPacket & {
  amount: string;
  client_operation_key: string;
  contribution_id: string;
  created_at_utc: string | Date;
  id: string;
  note: string | null;
  received_on: string | Date;
};

function canonicalDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function nullableDate(value: string | Date | null): string | null {
  return value === null ? null : canonicalDate(value);
}

function canonicalDateTime(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().replace("T", " ").replace("Z", "000")
    : value;
}

function validVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Partnership record version is invalid.");
  return value;
}

function commissionMode(value: string): CommissionContributionMode {
  if (value !== "partner_only" && value !== "user_one_side" && value !== "user_both") {
    throw new Error("Partnership commission contribution mode is invalid.");
  }
  return value;
}

function commissionStatus(value: string): CommissionStatus {
  if (value !== "expected" && value !== "agency_collected" && value !== "paid" && value !== "cancelled") {
    throw new Error("Partnership commission status is invalid.");
  }
  return value;
}

function contributionStatus(value: string): ContributionStatus {
  if (value !== "expected" && value !== "partial" && value !== "received" && value !== "cancelled") {
    throw new Error("Partnership contribution status is invalid.");
  }
  return value;
}

function transactionType(value: string): CommissionTransactionType {
  if (value !== "sale" && value !== "rental") throw new Error("Partnership transaction type is invalid.");
  return value;
}

function mapCommission(row: CommissionRow): PartnershipCommission {
  return {
    agencyCollectedOn: nullableDate(row.agency_collected_on),
    clientOperationKey: row.client_operation_key,
    closedOn: canonicalDate(row.closed_on),
    commissionBasisAmount: row.commission_basis_amount,
    contributionMode: commissionMode(row.contribution_mode),
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    description: row.description,
    id: row.id,
    note: row.note,
    paidOn: nullableDate(row.paid_on),
    projectId: row.project_id,
    projectName: row.project_name,
    projectShortCode: row.project_short_code,
    shareAmount: row.share_amount,
    shareRate: row.share_rate,
    status: commissionStatus(row.status),
    transactionType: transactionType(row.transaction_type),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: validVersion(row.version),
  };
}

function mapContribution(row: ContributionRow): PartnershipContribution {
  return {
    clientOperationKey: row.client_operation_key,
    contributionMonth: canonicalDate(row.contribution_month).slice(0, 7),
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    description: row.description,
    dueOn: canonicalDate(row.due_on),
    expectedAmount: row.expected_amount,
    id: row.id,
    note: row.note,
    projectId: row.project_id,
    projectName: row.project_name,
    projectShortCode: row.project_short_code,
    receivedAmount: row.received_amount,
    receivedOn: nullableDate(row.received_on),
    status: contributionStatus(row.status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: validVersion(row.version),
  };
}

function mapContributionReceipt(
  row: ContributionReceiptRow,
): PartnershipContributionReceipt {
  return {
    amount: row.amount,
    clientOperationKey: row.client_operation_key,
    contributionId: row.contribution_id,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    id: row.id,
    note: row.note,
    receivedOn: canonicalDate(row.received_on),
  };
}

const COMMISSION_COLUMNS = `
  pc.id, pc.client_operation_key, pc.project_id,
  p.display_name AS project_name, p.short_code AS project_short_code,
  pc.transaction_type, pc.description, pc.closed_on,
  pc.commission_basis_amount, pc.contribution_mode, pc.share_rate,
  pc.share_amount, pc.status, pc.agency_collected_on, pc.paid_on, pc.note,
  pc.version, pc.created_at_utc, pc.updated_at_utc`;

const CONTRIBUTION_COLUMNS = `
  pc.id, pc.client_operation_key, pc.project_id,
  p.display_name AS project_name, p.short_code AS project_short_code,
  pc.contribution_month, pc.description, pc.expected_amount, pc.due_on,
  pc.received_amount, pc.received_on, pc.status, pc.note, pc.version,
  pc.created_at_utc, pc.updated_at_utc`;

const CONTRIBUTION_RECEIPT_COLUMNS = `
  pcr.id, pcr.client_operation_key, pcr.contribution_id, pcr.amount,
  pcr.received_on, pcr.note, pcr.created_at_utc`;

function monthBounds(month: string): Readonly<{ start: string; next: string }> {
  const year = Number(month.slice(0, 4));
  const value = Number(month.slice(5, 7));
  const nextYear = value === 12 ? year + 1 : year;
  const nextMonth = value === 12 ? 1 : value + 1;
  return {
    next: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
    start: `${month}-01`,
  };
}

function filtersWhere(
  alias: string,
  dateColumn: string,
  filters: PartnershipListFilter,
): Readonly<{ sql: string; values: string[] }> {
  const clauses: string[] = [];
  const values: string[] = [];
  if (filters.projectId !== undefined) {
    clauses.push(`${alias}.project_id = ?`);
    values.push(filters.projectId);
  }
  if (filters.month !== undefined) {
    const bounds = monthBounds(filters.month);
    clauses.push(`${dateColumn} >= ?`, `${dateColumn} < ?`);
    values.push(bounds.start, bounds.next);
  }
  return {
    sql: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`,
    values,
  };
}

export async function listCommissionRecords(
  connection: PoolConnection,
  filters: PartnershipListFilter,
): Promise<readonly PartnershipCommission[]> {
  const where = filtersWhere("pc", "pc.closed_on", filters);
  const [rows] = await connection.execute<CommissionRow[]>(
    `SELECT ${COMMISSION_COLUMNS}
       FROM partnership_commission pc
       JOIN project p ON p.id = pc.project_id
       ${where.sql}
      ORDER BY pc.closed_on DESC, pc.created_at_utc DESC, pc.id ASC`,
    where.values,
  );
  return rows.map(mapCommission);
}

export async function findCommissionForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<PartnershipCommission | null> {
  const [rows] = await connection.execute<CommissionRow[]>(
    `SELECT ${COMMISSION_COLUMNS}
       FROM partnership_commission pc
       JOIN project p ON p.id = pc.project_id
      WHERE pc.id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapCommission(rows[0]) : null;
}

export async function findCommissionByOperationKeyForUpdate(
  connection: PoolConnection,
  key: string,
): Promise<PartnershipCommission | null> {
  const [rows] = await connection.execute<CommissionRow[]>(
    `SELECT ${COMMISSION_COLUMNS}
       FROM partnership_commission pc
       JOIN project p ON p.id = pc.project_id
      WHERE pc.client_operation_key = ?
      FOR UPDATE`,
    [key],
  );
  return rows[0] ? mapCommission(rows[0]) : null;
}

export async function insertCommissionRecordIdempotently(
  connection: PoolConnection,
  commission: PartnershipCommission,
): Promise<PartnershipCommission> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO partnership_commission
       (id, client_operation_key, project_id, transaction_type, description,
        closed_on, commission_basis_amount, contribution_mode, share_rate,
        share_amount, status, agency_collected_on, paid_on, note, version,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      commission.id, commission.clientOperationKey, commission.projectId,
      commission.transactionType, commission.description, commission.closedOn,
      commission.commissionBasisAmount, commission.contributionMode,
      commission.shareRate, commission.shareAmount, commission.status,
      commission.agencyCollectedOn, commission.paidOn, commission.note,
      commission.version, commission.createdAtUtc, commission.updatedAtUtc,
    ],
  );
  const stored = await findCommissionByOperationKeyForUpdate(connection, commission.clientOperationKey);
  if (!stored) throw new Error("Partnership commission insert failed.");
  return stored;
}

export async function updateCommissionRecord(
  connection: PoolConnection,
  commission: PartnershipCommission,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE partnership_commission
        SET project_id = ?, transaction_type = ?, description = ?, closed_on = ?,
            commission_basis_amount = ?, contribution_mode = ?, share_rate = ?,
            share_amount = ?, status = ?, agency_collected_on = ?, paid_on = ?,
            note = ?, version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      commission.projectId, commission.transactionType, commission.description,
      commission.closedOn, commission.commissionBasisAmount,
      commission.contributionMode, commission.shareRate, commission.shareAmount,
      commission.status, commission.agencyCollectedOn, commission.paidOn,
      commission.note, commission.version, commission.updatedAtUtc,
      commission.id, expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}

export async function listContributionRecords(
  connection: PoolConnection,
  filters: PartnershipListFilter,
): Promise<readonly PartnershipContribution[]> {
  const where = filtersWhere("pc", "pc.contribution_month", filters);
  const [rows] = await connection.execute<ContributionRow[]>(
    `SELECT ${CONTRIBUTION_COLUMNS}
       FROM partnership_contribution pc
       JOIN project p ON p.id = pc.project_id
       ${where.sql}
      ORDER BY pc.contribution_month DESC, pc.due_on DESC, pc.id ASC`,
    where.values,
  );
  return rows.map(mapContribution);
}

export async function findContributionForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<PartnershipContribution | null> {
  const [rows] = await connection.execute<ContributionRow[]>(
    `SELECT ${CONTRIBUTION_COLUMNS}
       FROM partnership_contribution pc
       JOIN project p ON p.id = pc.project_id
      WHERE pc.id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapContribution(rows[0]) : null;
}

export async function findContributionByOperationKeyForUpdate(
  connection: PoolConnection,
  key: string,
): Promise<PartnershipContribution | null> {
  const [rows] = await connection.execute<ContributionRow[]>(
    `SELECT ${CONTRIBUTION_COLUMNS}
       FROM partnership_contribution pc
       JOIN project p ON p.id = pc.project_id
      WHERE pc.client_operation_key = ?
      FOR UPDATE`,
    [key],
  );
  return rows[0] ? mapContribution(rows[0]) : null;
}

export async function findContributionByProjectMonthForUpdate(
  connection: PoolConnection,
  projectId: string,
  month: string,
): Promise<PartnershipContribution | null> {
  const [rows] = await connection.execute<ContributionRow[]>(
    `SELECT ${CONTRIBUTION_COLUMNS}
       FROM partnership_contribution pc
       JOIN project p ON p.id = pc.project_id
      WHERE pc.project_id = ? AND pc.contribution_month = ?
      FOR UPDATE`,
    [projectId, `${month}-01`],
  );
  return rows[0] ? mapContribution(rows[0]) : null;
}

export async function listContributionReceiptRecords(
  connection: PoolConnection,
  filters: PartnershipListFilter,
): Promise<readonly PartnershipContributionReceipt[]> {
  const where = filtersWhere("pc", "pc.contribution_month", filters);
  const [rows] = await connection.execute<ContributionReceiptRow[]>(
    `SELECT ${CONTRIBUTION_RECEIPT_COLUMNS}
       FROM partnership_contribution_receipt pcr
       JOIN partnership_contribution pc ON pc.id = pcr.contribution_id
       ${where.sql}
      ORDER BY pcr.received_on ASC, pcr.created_at_utc ASC, pcr.id ASC`,
    where.values,
  );
  return rows.map(mapContributionReceipt);
}

export async function findContributionReceiptByOperationKeyForUpdate(
  connection: PoolConnection,
  key: string,
): Promise<PartnershipContributionReceipt | null> {
  const [rows] = await connection.execute<ContributionReceiptRow[]>(
    `SELECT ${CONTRIBUTION_RECEIPT_COLUMNS}
       FROM partnership_contribution_receipt pcr
      WHERE pcr.client_operation_key = ?
      FOR UPDATE`,
    [key],
  );
  return rows[0] ? mapContributionReceipt(rows[0]) : null;
}

export async function insertContributionReceiptIdempotently(
  connection: PoolConnection,
  receipt: PartnershipContributionReceipt,
): Promise<PartnershipContributionReceipt> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO partnership_contribution_receipt
       (id, client_operation_key, contribution_id, amount, received_on, note,
        created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      receipt.id,
      receipt.clientOperationKey,
      receipt.contributionId,
      receipt.amount,
      receipt.receivedOn,
      receipt.note,
      receipt.createdAtUtc,
    ],
  );
  const stored = await findContributionReceiptByOperationKeyForUpdate(
    connection,
    receipt.clientOperationKey,
  );
  if (!stored) throw new Error("Partnership contribution receipt insert failed.");
  return stored;
}

export async function insertContributionRecordIdempotently(
  connection: PoolConnection,
  contribution: PartnershipContribution,
): Promise<PartnershipContribution> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO partnership_contribution
       (id, client_operation_key, project_id, contribution_month, description,
        expected_amount, due_on, received_amount, received_on, status, note,
        version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      contribution.id, contribution.clientOperationKey, contribution.projectId,
      `${contribution.contributionMonth}-01`, contribution.description,
      contribution.expectedAmount, contribution.dueOn,
      contribution.receivedAmount, contribution.receivedOn, contribution.status,
      contribution.note, contribution.version, contribution.createdAtUtc,
      contribution.updatedAtUtc,
    ],
  );
  const stored = await findContributionByOperationKeyForUpdate(connection, contribution.clientOperationKey);
  if (!stored) throw new ContributionMonthCollisionError();
  return stored;
}

export async function updateContributionRecord(
  connection: PoolConnection,
  contribution: PartnershipContribution,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE partnership_contribution
        SET project_id = ?, contribution_month = ?, description = ?,
            expected_amount = ?, due_on = ?, received_amount = ?,
            received_on = ?, status = ?, note = ?, version = ?,
            updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      contribution.projectId, `${contribution.contributionMonth}-01`,
      contribution.description, contribution.expectedAmount,
      contribution.dueOn, contribution.receivedAmount, contribution.receivedOn,
      contribution.status, contribution.note, contribution.version,
      contribution.updatedAtUtc, contribution.id, expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
