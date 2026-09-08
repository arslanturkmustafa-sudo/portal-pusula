import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { TaxStatus, TaxType } from "@/features/finance/tax-validation";

export type TaxObligationRecord = Readonly<{
  carriedVatCreditAmount: string;
  clientOperationKey: string;
  closingVatCreditAmount: string;
  createdAtUtc: string;
  currency: "TRY";
  description: string;
  dueOn: string;
  id: string;
  manualAdjustmentAmount: string;
  note: string | null;
  paidOn: string | null;
  payableAmount: string;
  periodMonth: string;
  status: TaxStatus;
  systemInputVatAmount: string;
  systemOutputVatAmount: string;
  taxType: TaxType;
  updatedAtUtc: string;
  version: number;
  voidedAtUtc: string | null;
  voidReason: string | null;
}>;

export type VatSourceSnapshot = Readonly<{
  sourceExpenseCount: number;
  sourceReceivableCount: number;
  systemInputVatAmount: string;
  systemOutputVatAmount: string;
}>;

export type TaxCashFlowRecord = Readonly<{
  description: string;
  dueOn: string;
  id: string;
  paidOn: string | null;
  payableAmount: string;
  status: "paid" | "planned";
  taxType: TaxType;
}>;

export class TaxObligationPeriodCollisionError extends Error {
  constructor() {
    super("A tax obligation already exists for this type and period.");
    this.name = "TaxObligationPeriodCollisionError";
  }
}

type TaxObligationRow = RowDataPacket & {
  carried_vat_credit_amount: string;
  client_operation_key: string;
  closing_vat_credit_amount: string;
  created_at_utc: Date | string;
  currency: string;
  description: string;
  due_on: Date | string;
  id: string;
  manual_adjustment_amount: string;
  note: string | null;
  paid_on: Date | string | null;
  payable_amount: string;
  period_month: Date | string;
  status: string;
  system_input_vat_amount: string;
  system_output_vat_amount: string;
  tax_type: string;
  updated_at_utc: Date | string;
  version: number;
  voided_at_utc: Date | string | null;
  void_reason: string | null;
};

type VatSumRow = RowDataPacket & {
  amount: string;
  source_count: number;
};

const COLUMNS = `
  id, client_operation_key, tax_type, period_month, description, due_on,
  system_output_vat_amount, system_input_vat_amount,
  carried_vat_credit_amount, manual_adjustment_amount, payable_amount,
  closing_vat_credit_amount, currency, status, paid_on, note, void_reason,
  voided_at_utc, version, created_at_utc, updated_at_utc`;

function canonicalDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function nullableDate(value: Date | string | null): string | null {
  return value === null ? null : canonicalDate(value);
}

function canonicalDateTime(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().replace("T", " ").replace("Z", "000")
    : value;
}

function nullableDateTime(value: Date | string | null): string | null {
  return value === null ? null : canonicalDateTime(value);
}

function taxType(value: string): TaxType {
  if (
    value !== "vat" &&
    value !== "income_tax" &&
    value !== "provisional_tax"
  ) {
    throw new Error("Tax obligation type is invalid.");
  }
  return value;
}

function taxStatus(value: string): TaxStatus {
  if (value !== "planned" && value !== "paid" && value !== "voided") {
    throw new Error("Tax obligation status is invalid.");
  }
  return value;
}

function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Tax VAT source count is invalid.");
  }
  return value;
}

function mapTaxObligation(row: TaxObligationRow): TaxObligationRecord {
  if (row.currency !== "TRY") throw new Error("Tax currency is invalid.");
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new Error("Tax obligation version is invalid.");
  }
  return {
    carriedVatCreditAmount: row.carried_vat_credit_amount,
    clientOperationKey: row.client_operation_key,
    closingVatCreditAmount: row.closing_vat_credit_amount,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    currency: "TRY",
    description: row.description,
    dueOn: canonicalDate(row.due_on),
    id: row.id,
    manualAdjustmentAmount: row.manual_adjustment_amount,
    note: row.note,
    paidOn: nullableDate(row.paid_on),
    payableAmount: row.payable_amount,
    periodMonth: canonicalDate(row.period_month).slice(0, 7),
    status: taxStatus(row.status),
    systemInputVatAmount: row.system_input_vat_amount,
    systemOutputVatAmount: row.system_output_vat_amount,
    taxType: taxType(row.tax_type),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: row.version,
    voidedAtUtc: nullableDateTime(row.voided_at_utc),
    voidReason: row.void_reason,
  };
}

function nextMonthStart(periodMonth: string): string {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

/**
 * System VAT is an operational estimate, not a statutory declaration. Opening
 * balance receivables are deliberately excluded because they carry no tax
 * period. Only generated contract-period receivables and active incurred
 * expenses have an unambiguous month in the current schema.
 */
export async function calculateVatSourceSnapshot(
  connection: PoolConnection,
  periodMonth: string,
): Promise<VatSourceSnapshot> {
  const periodStart = `${periodMonth}-01`;
  const [receivableRows] = await connection.execute<VatSumRow[]>(
    `SELECT COALESCE(SUM(vat_amount), 0) AS amount,
            COUNT(*) AS source_count
       FROM receivable
      WHERE BINARY record_state = BINARY 'active'
        AND BINARY source_type = BINARY 'contract_month'
        AND period_month = ?`,
    [periodStart],
  );
  const [expenseRows] = await connection.execute<VatSumRow[]>(
    `SELECT COALESCE(SUM(vat_amount), 0) AS amount,
            COUNT(*) AS source_count
       FROM expense
      WHERE BINARY status = BINARY 'active'
        AND incurred_on >= ?
        AND incurred_on < ?`,
    [periodStart, nextMonthStart(periodMonth)],
  );
  const receivable = receivableRows[0];
  const expense = expenseRows[0];
  if (!receivable || !expense) throw new Error("Tax VAT snapshot failed.");
  return {
    sourceExpenseCount: safeCount(expense.source_count),
    sourceReceivableCount: safeCount(receivable.source_count),
    systemInputVatAmount: expense.amount,
    systemOutputVatAmount: receivable.amount,
  };
}

export async function listTaxObligationRecords(
  connection: PoolConnection,
  periodMonth: string,
): Promise<readonly TaxObligationRecord[]> {
  const [rows] = await connection.execute<TaxObligationRow[]>(
    `SELECT ${COLUMNS}
       FROM tax_obligation
      WHERE period_month = ?
      ORDER BY period_month DESC, due_on DESC, created_at_utc DESC, id DESC`,
    [`${periodMonth}-01`],
  );
  return rows.map(mapTaxObligation);
}

export async function listTaxCashFlowRecords(
  connection: PoolConnection,
  startOn: string,
  endOn: string,
): Promise<readonly TaxCashFlowRecord[]> {
  const [rows] = await connection.execute<TaxObligationRow[]>(
    `SELECT ${COLUMNS}
       FROM tax_obligation
      WHERE BINARY status IN (BINARY 'planned', BINARY 'paid')
        AND payable_amount > 0
        AND due_on >= ?
        AND due_on <= ?
      ORDER BY due_on ASC, created_at_utc ASC, id ASC`,
    [startOn, endOn],
  );
  return rows.map(mapTaxObligation).map((tax) => ({
    description: tax.description,
    dueOn: tax.dueOn,
    id: tax.id,
    paidOn: tax.paidOn,
    payableAmount: tax.payableAmount,
    status: tax.status as "paid" | "planned",
    taxType: tax.taxType,
  }));
}

export async function findTaxObligationForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<TaxObligationRecord | null> {
  const [rows] = await connection.execute<TaxObligationRow[]>(
    `SELECT ${COLUMNS}
       FROM tax_obligation
      WHERE id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapTaxObligation(rows[0]) : null;
}

export async function findTaxObligationByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<TaxObligationRecord | null> {
  const [rows] = await connection.execute<TaxObligationRow[]>(
    `SELECT ${COLUMNS}
       FROM tax_obligation
      WHERE client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapTaxObligation(rows[0]) : null;
}

export async function findTaxObligationByTypePeriodForUpdate(
  connection: PoolConnection,
  taxTypeValue: TaxType,
  periodMonth: string,
): Promise<TaxObligationRecord | null> {
  const [rows] = await connection.execute<TaxObligationRow[]>(
    `SELECT ${COLUMNS}
       FROM tax_obligation
      WHERE tax_type = ? AND period_month = ?
      FOR UPDATE`,
    [taxTypeValue, `${periodMonth}-01`],
  );
  return rows[0] ? mapTaxObligation(rows[0]) : null;
}

export async function insertTaxObligationRecordIdempotently(
  connection: PoolConnection,
  tax: TaxObligationRecord,
): Promise<TaxObligationRecord> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO tax_obligation
       (id, client_operation_key, tax_type, period_month, description, due_on,
        system_output_vat_amount, system_input_vat_amount,
        carried_vat_credit_amount, manual_adjustment_amount, payable_amount,
        closing_vat_credit_amount, currency, status, paid_on, note, void_reason,
        voided_at_utc, version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      tax.id,
      tax.clientOperationKey,
      tax.taxType,
      `${tax.periodMonth}-01`,
      tax.description,
      tax.dueOn,
      tax.systemOutputVatAmount,
      tax.systemInputVatAmount,
      tax.carriedVatCreditAmount,
      tax.manualAdjustmentAmount,
      tax.payableAmount,
      tax.closingVatCreditAmount,
      tax.currency,
      tax.status,
      tax.paidOn,
      tax.note,
      tax.voidReason,
      tax.voidedAtUtc,
      tax.version,
      tax.createdAtUtc,
      tax.updatedAtUtc,
    ],
  );
  const stored = await findTaxObligationByOperationKeyForUpdate(
    connection,
    tax.clientOperationKey,
  );
  if (!stored) {
    if (
      await findTaxObligationByTypePeriodForUpdate(
        connection,
        tax.taxType,
        tax.periodMonth,
      )
    ) {
      throw new TaxObligationPeriodCollisionError();
    }
    throw new Error("Tax obligation insert failed.");
  }
  return stored;
}

export async function updateTaxObligationRecord(
  connection: PoolConnection,
  tax: TaxObligationRecord,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE tax_obligation
        SET period_month = ?, description = ?, due_on = ?,
            system_output_vat_amount = ?, system_input_vat_amount = ?,
            carried_vat_credit_amount = ?, manual_adjustment_amount = ?,
            payable_amount = ?, closing_vat_credit_amount = ?, status = ?,
            paid_on = ?, note = ?, void_reason = ?, voided_at_utc = ?,
            version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      `${tax.periodMonth}-01`,
      tax.description,
      tax.dueOn,
      tax.systemOutputVatAmount,
      tax.systemInputVatAmount,
      tax.carriedVatCreditAmount,
      tax.manualAdjustmentAmount,
      tax.payableAmount,
      tax.closingVatCreditAmount,
      tax.status,
      tax.paidOn,
      tax.note,
      tax.voidReason,
      tax.voidedAtUtc,
      tax.version,
      tax.updatedAtUtc,
      tax.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
