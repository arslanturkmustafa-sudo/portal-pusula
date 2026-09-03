import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  ExpenseListFilter,
  InstallmentListFilter,
} from "@/features/finance/spending-validation";
import { monthBounds } from "@/features/finance/period";

export type CreditCardStatus = "active" | "inactive";
export type ExpenseStatus = "active" | "voided";
export type ExpenseCategory =
  | "rent"
  | "software_subscription"
  | "transportation"
  | "meals_hospitality"
  | "marketing"
  | "office"
  | "external_service"
  | "tax_fee"
  | "other";
export type ExpenseDocumentType = "none" | "invoice" | "receipt" | "other";
export type ExpensePaymentMethod =
  | "cash"
  | "bank_transfer"
  | "credit_card"
  | "other";
export type InstallmentStoredStatus = "paid" | "planned";

export type CreditCard = Readonly<{
  bankName: string | null;
  clientOperationKey: string;
  createdAtUtc: string;
  creditLimitAmount: string | null;
  displayName: string;
  id: string;
  lastFour: string | null;
  note: string | null;
  paymentDueDay: number;
  statementClosingDay: number;
  status: CreditCardStatus;
  updatedAtUtc: string;
  version: number;
}>;

export type Expense = Readonly<{
  category: ExpenseCategory;
  clientOperationKey: string;
  createdAtUtc: string;
  creditCardId: string | null;
  creditCardName: string | null;
  currency: "TRY";
  description: string;
  documentNumber: string | null;
  documentType: ExpenseDocumentType;
  id: string;
  incurredOn: string;
  installmentCount: number;
  netAmount: string;
  note: string | null;
  paymentMethod: ExpensePaymentMethod;
  projectId: string | null;
  projectName: string | null;
  projectShortCode: string | null;
  status: ExpenseStatus;
  totalAmount: string;
  updatedAtUtc: string;
  vatAmount: string;
  vendorName: string | null;
  version: number;
  voidedAtUtc: string | null;
  voidReason: string | null;
}>;

export type CardInstallment = Readonly<{
  amount: string;
  createdAtUtc: string;
  creditCardId: string;
  creditCardName: string;
  dueOn: string;
  expenseDescription: string;
  expenseId: string;
  id: string;
  installmentCount: number;
  installmentNumber: number;
  paidOn: string | null;
  statementMonth: string;
  status: InstallmentStoredStatus;
  updatedAtUtc: string;
  version: number;
}>;

export type NewCardInstallment = Omit<
  CardInstallment,
  | "createdAtUtc"
  | "creditCardId"
  | "creditCardName"
  | "expenseDescription"
  | "updatedAtUtc"
> &
  Readonly<{ createdAtUtc: string; updatedAtUtc: string }>;

type CreditCardRow = RowDataPacket & {
  bank_name: string | null;
  client_operation_key: string;
  created_at_utc: string | Date;
  credit_limit_amount: string | null;
  display_name: string;
  id: string;
  last_four: string | null;
  note: string | null;
  payment_due_day: number;
  statement_closing_day: number;
  status: string;
  updated_at_utc: string | Date;
  version: number;
};

type ExpenseRow = RowDataPacket & {
  category: string;
  client_operation_key: string;
  created_at_utc: string | Date;
  credit_card_id: string | null;
  credit_card_name: string | null;
  currency: string;
  description: string;
  document_number: string | null;
  document_type: string | null;
  id: string;
  incurred_on: string | Date;
  installment_count: number;
  net_amount: string;
  note: string | null;
  payment_method: string;
  project_id: string | null;
  project_name: string | null;
  project_short_code: string | null;
  status: string;
  total_amount: string;
  updated_at_utc: string | Date;
  vat_amount: string;
  vendor_name: string | null;
  version: number;
  void_reason: string | null;
  voided_at_utc: string | Date | null;
};

type InstallmentRow = RowDataPacket & {
  amount: string;
  created_at_utc: string | Date;
  credit_card_id: string;
  credit_card_name: string;
  due_on: string | Date;
  expense_description: string;
  expense_id: string;
  id: string;
  installment_count: number;
  installment_number: number;
  paid_on: string | Date | null;
  statement_month: string | Date;
  status: string;
  updated_at_utc: string | Date;
  version: number;
};

function canonicalDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function canonicalMonth(value: string | Date): string {
  return canonicalDate(value).slice(0, 7);
}

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function nullableDateTime(value: string | Date | null): string | null {
  return value === null ? null : canonicalDateTime(value);
}

function validVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Record version is invalid.");
  }
  return value;
}

function mapCardStatus(value: string): CreditCardStatus {
  if (value !== "active" && value !== "inactive") {
    throw new Error("Credit card status is invalid.");
  }
  return value;
}

function mapExpenseStatus(value: string): ExpenseStatus {
  if (value !== "active" && value !== "voided") {
    throw new Error("Expense status is invalid.");
  }
  return value;
}

function mapCategory(value: string): ExpenseCategory {
  if (
    value !== "rent" &&
    value !== "software_subscription" &&
    value !== "transportation" &&
    value !== "meals_hospitality" &&
    value !== "marketing" &&
    value !== "office" &&
    value !== "external_service" &&
    value !== "tax_fee" &&
    value !== "other"
  ) {
    throw new Error("Expense category is invalid.");
  }
  return value;
}

function mapPaymentMethod(value: string): ExpensePaymentMethod {
  if (
    value !== "cash" &&
    value !== "bank_transfer" &&
    value !== "credit_card" &&
    value !== "other"
  ) {
    throw new Error("Expense payment method is invalid.");
  }
  return value;
}

function mapDocumentType(value: string | null): ExpenseDocumentType {
  if (value === null) return "none";
  if (value !== "invoice" && value !== "receipt" && value !== "other") {
    throw new Error("Expense document type is invalid.");
  }
  return value;
}

function mapInstallmentStatus(value: string): InstallmentStoredStatus {
  if (value !== "paid" && value !== "planned") {
    throw new Error("Card installment status is invalid.");
  }
  return value;
}

function mapCreditCard(row: CreditCardRow): CreditCard {
  return {
    bankName: row.bank_name,
    clientOperationKey: row.client_operation_key,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    creditLimitAmount: row.credit_limit_amount,
    displayName: row.display_name,
    id: row.id,
    lastFour: row.last_four,
    note: row.note,
    paymentDueDay: row.payment_due_day,
    statementClosingDay: row.statement_closing_day,
    status: mapCardStatus(row.status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: validVersion(row.version),
  };
}

function mapExpense(row: ExpenseRow): Expense {
  if (row.currency !== "TRY") throw new Error("Expense currency is invalid.");
  return {
    category: mapCategory(row.category),
    clientOperationKey: row.client_operation_key,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    creditCardId: row.credit_card_id,
    creditCardName: row.credit_card_name,
    currency: "TRY",
    description: row.description,
    documentNumber: row.document_number,
    documentType: mapDocumentType(row.document_type),
    id: row.id,
    incurredOn: canonicalDate(row.incurred_on),
    installmentCount: row.installment_count,
    netAmount: row.net_amount,
    note: row.note,
    paymentMethod: mapPaymentMethod(row.payment_method),
    projectId: row.project_id,
    projectName: row.project_name,
    projectShortCode: row.project_short_code,
    status: mapExpenseStatus(row.status),
    totalAmount: row.total_amount,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    vatAmount: row.vat_amount,
    vendorName: row.vendor_name,
    version: validVersion(row.version),
    voidedAtUtc: nullableDateTime(row.voided_at_utc),
    voidReason: row.void_reason,
  };
}

function mapInstallment(row: InstallmentRow): CardInstallment {
  return {
    amount: row.amount,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    creditCardId: row.credit_card_id,
    creditCardName: row.credit_card_name,
    dueOn: canonicalDate(row.due_on),
    expenseDescription: row.expense_description,
    expenseId: row.expense_id,
    id: row.id,
    installmentCount: row.installment_count,
    installmentNumber: row.installment_number,
    paidOn: row.paid_on === null ? null : canonicalDate(row.paid_on),
    statementMonth: canonicalMonth(row.statement_month),
    status: mapInstallmentStatus(row.status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: validVersion(row.version),
  };
}

const CARD_COLUMNS = `
  id, client_operation_key, display_name, bank_name, last_four,
  statement_closing_day, payment_due_day, credit_limit_amount, status, note,
  version, created_at_utc, updated_at_utc`;

const EXPENSE_COLUMNS = `
  e.id, e.client_operation_key, e.project_id,
  p.display_name AS project_name, p.short_code AS project_short_code,
  e.credit_card_id, cc.display_name AS credit_card_name, e.incurred_on,
  e.category, e.description, e.vendor_name, e.document_type,
  e.document_number, e.payment_method, e.net_amount, e.vat_amount,
  e.total_amount, e.currency, e.installment_count, e.status, e.void_reason,
  e.voided_at_utc, e.note, e.version, e.created_at_utc, e.updated_at_utc`;

const INSTALLMENT_COLUMNS = `
  ci.id, ci.expense_id, e.credit_card_id,
  cc.display_name AS credit_card_name, e.description AS expense_description,
  ci.installment_number, ci.installment_count, ci.statement_month, ci.due_on,
  ci.amount, ci.status, ci.paid_on, ci.version, ci.created_at_utc,
  ci.updated_at_utc`;

export async function listCreditCardRecords(
  connection: PoolConnection,
): Promise<readonly CreditCard[]> {
  const [rows] = await connection.execute<CreditCardRow[]>(
    `SELECT ${CARD_COLUMNS}
       FROM credit_card
      ORDER BY FIELD(status, 'active', 'inactive'), display_name ASC, id ASC`,
  );
  return rows.map(mapCreditCard);
}

export async function findCreditCardForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<CreditCard | null> {
  const [rows] = await connection.execute<CreditCardRow[]>(
    `SELECT ${CARD_COLUMNS} FROM credit_card WHERE id = ? FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapCreditCard(rows[0]) : null;
}

export async function findCreditCardByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<CreditCard | null> {
  const [rows] = await connection.execute<CreditCardRow[]>(
    `SELECT ${CARD_COLUMNS}
       FROM credit_card
      WHERE client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapCreditCard(rows[0]) : null;
}

export async function insertCreditCardRecordIdempotently(
  connection: PoolConnection,
  card: CreditCard,
): Promise<CreditCard> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO credit_card
       (id, client_operation_key, display_name, bank_name, last_four,
        statement_closing_day, payment_due_day, credit_limit_amount, status,
        note, version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      card.id,
      card.clientOperationKey,
      card.displayName,
      card.bankName,
      card.lastFour,
      card.statementClosingDay,
      card.paymentDueDay,
      card.creditLimitAmount,
      card.status,
      card.note,
      card.version,
      card.createdAtUtc,
      card.updatedAtUtc,
    ],
  );
  const persisted = await findCreditCardByOperationKeyForUpdate(
    connection,
    card.clientOperationKey,
  );
  if (!persisted) throw new Error("Credit card insert failed.");
  return persisted;
}

export async function updateCreditCardRecord(
  connection: PoolConnection,
  card: CreditCard,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE credit_card
        SET display_name = ?, bank_name = ?, last_four = ?,
            statement_closing_day = ?, payment_due_day = ?,
            credit_limit_amount = ?, status = ?, note = ?, version = ?,
            updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      card.displayName,
      card.bankName,
      card.lastFour,
      card.statementClosingDay,
      card.paymentDueDay,
      card.creditLimitAmount,
      card.status,
      card.note,
      card.version,
      card.updatedAtUtc,
      card.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}

export async function listExpenseRecords(
  connection: PoolConnection,
  filters: ExpenseListFilter,
  range: Readonly<{ startOn: string; nextStartOn: string }> | null,
): Promise<readonly Expense[]> {
  const clauses: string[] = [];
  const values: string[] = [];
  if (range !== null) {
    clauses.push("e.incurred_on >= ?", "e.incurred_on < ?");
    values.push(range.startOn, range.nextStartOn);
  }
  if (filters.projectId !== undefined) {
    clauses.push("e.project_id = ?");
    values.push(filters.projectId);
  }
  if (filters.category !== undefined) {
    clauses.push("e.category = ?");
    values.push(filters.category);
  }
  if (filters.paymentMethod !== undefined) {
    clauses.push("e.payment_method = ?");
    values.push(filters.paymentMethod);
  }
  const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
  const [rows] = await connection.execute<ExpenseRow[]>(
    `SELECT ${EXPENSE_COLUMNS}
       FROM expense e
       LEFT JOIN project p ON p.id = e.project_id
       LEFT JOIN credit_card cc ON cc.id = e.credit_card_id
       ${where}
      ORDER BY e.incurred_on DESC, e.created_at_utc DESC, e.id ASC`,
    values,
  );
  return rows.map(mapExpense);
}

export async function findExpenseForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<Expense | null> {
  const [rows] = await connection.execute<ExpenseRow[]>(
    `SELECT ${EXPENSE_COLUMNS}
       FROM expense e
       LEFT JOIN project p ON p.id = e.project_id
       LEFT JOIN credit_card cc ON cc.id = e.credit_card_id
      WHERE e.id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapExpense(rows[0]) : null;
}

export async function findExpenseByOperationKeyForUpdate(
  connection: PoolConnection,
  clientOperationKey: string,
): Promise<Expense | null> {
  const [rows] = await connection.execute<ExpenseRow[]>(
    `SELECT ${EXPENSE_COLUMNS}
       FROM expense e
       LEFT JOIN project p ON p.id = e.project_id
       LEFT JOIN credit_card cc ON cc.id = e.credit_card_id
      WHERE e.client_operation_key = ?
      FOR UPDATE`,
    [clientOperationKey],
  );
  return rows[0] ? mapExpense(rows[0]) : null;
}

export async function insertExpenseRecordIdempotently(
  connection: PoolConnection,
  expense: Expense,
): Promise<Expense> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO expense
       (id, client_operation_key, project_id, credit_card_id, incurred_on,
        category, description, vendor_name, document_type, document_number,
        payment_method, net_amount, vat_amount, total_amount, currency,
        installment_count, status, void_reason, voided_at_utc, note, version,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      expense.id,
      expense.clientOperationKey,
      expense.projectId,
      expense.creditCardId,
      expense.incurredOn,
      expense.category,
      expense.description,
      expense.vendorName,
      expense.documentType === "none" ? null : expense.documentType,
      expense.documentNumber,
      expense.paymentMethod,
      expense.netAmount,
      expense.vatAmount,
      expense.totalAmount,
      expense.currency,
      expense.installmentCount,
      expense.status,
      expense.voidReason,
      expense.voidedAtUtc,
      expense.note,
      expense.version,
      expense.createdAtUtc,
      expense.updatedAtUtc,
    ],
  );
  const persisted = await findExpenseByOperationKeyForUpdate(
    connection,
    expense.clientOperationKey,
  );
  if (!persisted) throw new Error("Expense insert failed.");
  return persisted;
}

export async function updateExpenseRecord(
  connection: PoolConnection,
  expense: Expense,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE expense
        SET project_id = ?, credit_card_id = ?, incurred_on = ?, category = ?,
            description = ?, vendor_name = ?, document_type = ?,
            document_number = ?, payment_method = ?, net_amount = ?,
            vat_amount = ?, total_amount = ?, currency = ?,
            installment_count = ?, status = ?, void_reason = ?,
            voided_at_utc = ?, note = ?, version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      expense.projectId,
      expense.creditCardId,
      expense.incurredOn,
      expense.category,
      expense.description,
      expense.vendorName,
      expense.documentType === "none" ? null : expense.documentType,
      expense.documentNumber,
      expense.paymentMethod,
      expense.netAmount,
      expense.vatAmount,
      expense.totalAmount,
      expense.currency,
      expense.installmentCount,
      expense.status,
      expense.voidReason,
      expense.voidedAtUtc,
      expense.note,
      expense.version,
      expense.updatedAtUtc,
      expense.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}

export async function listExpenseInstallmentsForUpdate(
  connection: PoolConnection,
  expenseId: string,
): Promise<readonly CardInstallment[]> {
  const [rows] = await connection.execute<InstallmentRow[]>(
    `SELECT ${INSTALLMENT_COLUMNS}
       FROM credit_card_installment ci
       JOIN expense e ON e.id = ci.expense_id
       JOIN credit_card cc ON cc.id = e.credit_card_id
      WHERE ci.expense_id = ?
      ORDER BY ci.installment_number ASC
      FOR UPDATE`,
    [expenseId],
  );
  return rows.map(mapInstallment);
}

export async function deletePlannedExpenseInstallments(
  connection: PoolConnection,
  expenseId: string,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `DELETE FROM credit_card_installment
      WHERE expense_id = ? AND status = 'planned'`,
    [expenseId],
  );
}

export async function insertCardInstallmentRecords(
  connection: PoolConnection,
  installments: readonly NewCardInstallment[],
): Promise<void> {
  for (const installment of installments) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO credit_card_installment
         (id, expense_id, installment_number, installment_count,
          statement_month, due_on, amount, status, paid_on, version,
          created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        installment.id,
        installment.expenseId,
        installment.installmentNumber,
        installment.installmentCount,
        `${installment.statementMonth}-01`,
        installment.dueOn,
        installment.amount,
        installment.status,
        installment.paidOn,
        installment.version,
        installment.createdAtUtc,
        installment.updatedAtUtc,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new Error("Card installment insert failed.");
    }
  }
}

export async function listCardInstallmentRecords(
  connection: PoolConnection,
  filters: InstallmentListFilter,
): Promise<readonly CardInstallment[]> {
  const clauses = ["e.status = 'active'"];
  const values: string[] = [];
  if (filters.month !== undefined) {
    const bounds = monthBounds(filters.month);
    clauses.push("ci.due_on >= ?", "ci.due_on < ?");
    values.push(bounds.monthStart, bounds.nextMonthStart);
  }
  if (filters.cardId !== undefined) {
    clauses.push("e.credit_card_id = ?");
    values.push(filters.cardId);
  }
  const [rows] = await connection.execute<InstallmentRow[]>(
    `SELECT ${INSTALLMENT_COLUMNS}
       FROM credit_card_installment ci
       JOIN expense e ON e.id = ci.expense_id
       JOIN credit_card cc ON cc.id = e.credit_card_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY ci.due_on ASC, cc.display_name ASC, ci.id ASC`,
    values,
  );
  return rows.map(mapInstallment);
}

export async function findCardInstallmentForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<(CardInstallment & Readonly<{ expenseStatus: ExpenseStatus }>) | null> {
  const [rows] = await connection.execute<
    (InstallmentRow & { expense_status: string })[]
  >(
    `SELECT ${INSTALLMENT_COLUMNS}, e.status AS expense_status
       FROM credit_card_installment ci
       JOIN expense e ON e.id = ci.expense_id
       JOIN credit_card cc ON cc.id = e.credit_card_id
      WHERE ci.id = ?
      FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  return row
    ? { ...mapInstallment(row), expenseStatus: mapExpenseStatus(row.expense_status) }
    : null;
}

export async function updateCardInstallmentRecord(
  connection: PoolConnection,
  installment: CardInstallment,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE credit_card_installment
        SET status = ?, paid_on = ?, version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      installment.status,
      installment.paidOn,
      installment.version,
      installment.updatedAtUtc,
      installment.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
