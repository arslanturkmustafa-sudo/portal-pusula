import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  RecurringExpenseFrequency,
  RecurringExpenseStatus,
} from "@/features/finance/recurring-expense-validation";
import type { ExpensePaymentMethod } from "@/features/finance/spending-repository";

export type RecurringExpensePlan = Readonly<{
  anchorDay: number;
  category: string;
  clientOperationKey: string;
  createdAtUtc: string;
  creditCardId: string | null;
  creditCardName: string | null;
  currency: "TRY";
  description: string;
  endsOn: string | null;
  frequency: RecurringExpenseFrequency;
  id: string;
  netAmount: string;
  nextDueOn: string;
  note: string | null;
  paymentMethod: ExpensePaymentMethod;
  projectId: string | null;
  projectName: string | null;
  projectShortCode: string | null;
  sourceAccountId: string | null;
  sourceAccountName: string | null;
  sourceAccountType: "bank" | "cash" | null;
  status: RecurringExpenseStatus;
  totalAmount: string;
  updatedAtUtc: string;
  vatAmount: string;
  vendorName: string | null;
  version: number;
}>;

type RecurringExpenseRow = RowDataPacket & {
  anchor_day: number;
  category: string;
  client_operation_key: string;
  created_at_utc: string | Date;
  credit_card_id: string | null;
  credit_card_name: string | null;
  currency: string;
  description: string;
  ends_on: string | Date | null;
  frequency: string;
  id: string;
  net_amount: string;
  next_due_on: string | Date;
  note: string | null;
  payment_method: string;
  project_id: string | null;
  project_name: string | null;
  project_short_code: string | null;
  source_account_id: string | null;
  source_account_name: string | null;
  source_account_type: string | null;
  status: string;
  total_amount: string;
  updated_at_utc: string | Date;
  vat_amount: string;
  vendor_name: string | null;
  version: number;
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

function frequency(value: string): RecurringExpenseFrequency {
  if (value !== "weekly" && value !== "monthly") {
    throw new Error("Recurring expense frequency is invalid.");
  }
  return value;
}

function status(value: string): RecurringExpenseStatus {
  if (value !== "active" && value !== "paused") {
    throw new Error("Recurring expense status is invalid.");
  }
  return value;
}

function paymentMethod(value: string): ExpensePaymentMethod {
  if (
    value !== "bank_transfer" &&
    value !== "cash" &&
    value !== "credit_card" &&
    value !== "other"
  ) {
    throw new Error("Recurring expense payment method is invalid.");
  }
  return value;
}

function sourceAccountType(value: string | null): "bank" | "cash" | null {
  if (value === null || value === "bank" || value === "cash") return value;
  throw new Error("Recurring expense source account type is invalid.");
}

function mapPlan(row: RecurringExpenseRow): RecurringExpensePlan {
  if (row.currency !== "TRY") {
    throw new Error("Recurring expense currency is invalid.");
  }
  if (!Number.isSafeInteger(row.anchor_day) || row.anchor_day < 1 || row.anchor_day > 31) {
    throw new Error("Recurring expense anchor day is invalid.");
  }
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new Error("Recurring expense version is invalid.");
  }
  return {
    anchorDay: row.anchor_day,
    category: row.category,
    clientOperationKey: row.client_operation_key,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    creditCardId: row.credit_card_id,
    creditCardName: row.credit_card_name,
    currency: "TRY",
    description: row.description,
    endsOn: nullableDate(row.ends_on),
    frequency: frequency(row.frequency),
    id: row.id,
    netAmount: row.net_amount,
    nextDueOn: canonicalDate(row.next_due_on),
    note: row.note,
    paymentMethod: paymentMethod(row.payment_method),
    projectId: row.project_id,
    projectName: row.project_name,
    projectShortCode: row.project_short_code,
    sourceAccountId: row.source_account_id,
    sourceAccountName: row.source_account_name,
    sourceAccountType: sourceAccountType(row.source_account_type),
    status: status(row.status),
    totalAmount: row.total_amount,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    vatAmount: row.vat_amount,
    vendorName: row.vendor_name,
    version: row.version,
  };
}

const PLAN_COLUMNS = `
  recurring.id, recurring.client_operation_key, recurring.project_id,
  project.display_name AS project_name, project.short_code AS project_short_code,
  recurring.credit_card_id, card.display_name AS credit_card_name,
  recurring.source_account_id, account.display_name AS source_account_name,
  account.account_type AS source_account_type, recurring.category,
  recurring.description, recurring.vendor_name, recurring.payment_method,
  recurring.net_amount, recurring.vat_amount, recurring.total_amount,
  recurring.currency, recurring.frequency, recurring.anchor_day,
  recurring.next_due_on, recurring.ends_on, recurring.status, recurring.note,
  recurring.version, recurring.created_at_utc, recurring.updated_at_utc`;

export async function listRecurringExpensePlanRecords(
  connection: PoolConnection,
): Promise<readonly RecurringExpensePlan[]> {
  const [rows] = await connection.execute<RecurringExpenseRow[]>(
    `SELECT ${PLAN_COLUMNS}
       FROM recurring_expense recurring
       LEFT JOIN project project ON project.id = recurring.project_id
       LEFT JOIN credit_card card ON card.id = recurring.credit_card_id
       LEFT JOIN finance_account account ON account.id = recurring.source_account_id
      ORDER BY FIELD(recurring.status, 'active', 'paused'),
               recurring.next_due_on ASC, recurring.description ASC,
               recurring.id ASC`,
  );
  return rows.map(mapPlan);
}

export async function findRecurringExpensePlanForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<RecurringExpensePlan | null> {
  const [rows] = await connection.execute<RecurringExpenseRow[]>(
    `SELECT ${PLAN_COLUMNS}
       FROM recurring_expense recurring
       LEFT JOIN project project ON project.id = recurring.project_id
       LEFT JOIN credit_card card ON card.id = recurring.credit_card_id
       LEFT JOIN finance_account account ON account.id = recurring.source_account_id
      WHERE recurring.id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function findRecurringExpensePlanByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<RecurringExpensePlan | null> {
  const [rows] = await connection.execute<RecurringExpenseRow[]>(
    `SELECT ${PLAN_COLUMNS}
       FROM recurring_expense recurring
       LEFT JOIN project project ON project.id = recurring.project_id
       LEFT JOIN credit_card card ON card.id = recurring.credit_card_id
       LEFT JOIN finance_account account ON account.id = recurring.source_account_id
      WHERE recurring.client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function insertRecurringExpensePlanIdempotently(
  connection: PoolConnection,
  plan: RecurringExpensePlan,
): Promise<RecurringExpensePlan> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO recurring_expense
       (id, client_operation_key, project_id, credit_card_id, source_account_id,
        category, description, vendor_name, payment_method, net_amount,
        vat_amount, total_amount, currency, frequency, anchor_day, next_due_on,
        ends_on, status, note, version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      plan.id,
      plan.clientOperationKey,
      plan.projectId,
      plan.creditCardId,
      plan.sourceAccountId,
      plan.category,
      plan.description,
      plan.vendorName,
      plan.paymentMethod,
      plan.netAmount,
      plan.vatAmount,
      plan.totalAmount,
      plan.currency,
      plan.frequency,
      plan.anchorDay,
      plan.nextDueOn,
      plan.endsOn,
      plan.status,
      plan.note,
      plan.version,
      plan.createdAtUtc,
      plan.updatedAtUtc,
    ],
  );
  const stored = await findRecurringExpensePlanByOperationKeyForUpdate(
    connection,
    plan.clientOperationKey,
  );
  if (!stored) throw new Error("Recurring expense plan insert failed.");
  return stored;
}

export async function updateRecurringExpensePlanRecord(
  connection: PoolConnection,
  plan: RecurringExpensePlan,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE recurring_expense
        SET project_id = ?, credit_card_id = ?, source_account_id = ?,
            category = ?, description = ?, vendor_name = ?, payment_method = ?,
            net_amount = ?, vat_amount = ?, total_amount = ?, currency = ?,
            frequency = ?, anchor_day = ?, next_due_on = ?, ends_on = ?,
            status = ?, note = ?, version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      plan.projectId,
      plan.creditCardId,
      plan.sourceAccountId,
      plan.category,
      plan.description,
      plan.vendorName,
      plan.paymentMethod,
      plan.netAmount,
      plan.vatAmount,
      plan.totalAmount,
      plan.currency,
      plan.frequency,
      plan.anchorDay,
      plan.nextDueOn,
      plan.endsOn,
      plan.status,
      plan.note,
      plan.version,
      plan.updatedAtUtc,
      plan.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
