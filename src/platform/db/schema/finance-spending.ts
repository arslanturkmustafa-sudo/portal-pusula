import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { project } from "./project";

export const creditCard = mysqlTable(
  "credit_card",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    displayName: varchar("display_name", { length: 191 }).notNull(),
    bankName: varchar("bank_name", { length: 191 }),
    lastFour: char("last_four", { length: 4 }),
    statementClosingDay: tinyint("statement_closing_day", {
      unsigned: true,
    }).notNull(),
    paymentDueDay: tinyint("payment_due_day", { unsigned: true }).notNull(),
    creditLimitAmount: decimal("credit_limit_amount", {
      precision: 19,
      scale: 4,
    }),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    note: varchar("note", { length: 2000 }),
    version: int("version", { unsigned: true }).default(1).notNull(),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
    updatedAtUtc: datetime("updated_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_credit_card_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_credit_card_display_name",
      sql`CHAR_LENGTH(${table.displayName}) BETWEEN 1 AND 191
        AND ${table.displayName} = TRIM(${table.displayName})`,
    ),
    check(
      "chk_credit_card_optional_fields",
      sql`(${table.bankName} IS NULL OR (
          CHAR_LENGTH(${table.bankName}) BETWEEN 1 AND 191
          AND ${table.bankName} = TRIM(${table.bankName})
        ))
        AND (${table.lastFour} IS NULL OR BINARY ${table.lastFour} REGEXP '^[0-9]{4}$')
        AND (${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_credit_card_cycle",
      sql`${table.statementClosingDay} BETWEEN 1 AND 31
        AND ${table.paymentDueDay} BETWEEN 1 AND 31`,
    ),
    check(
      "chk_credit_card_limit",
      sql`${table.creditLimitAmount} IS NULL OR ${table.creditLimitAmount} > 0`,
    ),
    check(
      "chk_credit_card_status",
      sql`BINARY ${table.status} IN (BINARY 'active', BINARY 'inactive')`,
    ),
    check("chk_credit_card_version", sql`${table.version} >= 1`),
    check(
      "chk_credit_card_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    uniqueIndex("uq_credit_card_client_operation").on(
      table.clientOperationKey,
    ),
    index("idx_credit_card_status_name").on(table.status, table.displayName),
  ],
);

export const expense = mysqlTable(
  "expense",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }),
    creditCardId: char("credit_card_id", { length: 36 }),
    incurredOn: date("incurred_on", { mode: "string" }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    vendorName: varchar("vendor_name", { length: 191 }),
    documentType: varchar("document_type", { length: 16 }),
    documentNumber: varchar("document_number", { length: 64 }),
    paymentMethod: varchar("payment_method", { length: 24 }).notNull(),
    netAmount: decimal("net_amount", { precision: 19, scale: 4 }).notNull(),
    vatAmount: decimal("vat_amount", { precision: 19, scale: 4 }).notNull(),
    totalAmount: decimal("total_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    installmentCount: smallint("installment_count", { unsigned: true })
      .default(1)
      .notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    voidReason: varchar("void_reason", { length: 2000 }),
    voidedAtUtc: datetime("voided_at_utc", { fsp: 6, mode: "string" }),
    note: varchar("note", { length: 2000 }),
    version: int("version", { unsigned: true }).default(1).notNull(),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
    updatedAtUtc: datetime("updated_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_expense_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (${table.projectId} IS NULL OR (
          OCTET_LENGTH(${table.projectId}) = 36
          AND BINARY ${table.projectId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (${table.creditCardId} IS NULL OR (
          OCTET_LENGTH(${table.creditCardId}) = 36
          AND BINARY ${table.creditCardId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))`,
    ),
    check(
      "chk_expense_category",
      sql`BINARY ${table.category} IN (
        BINARY 'rent', BINARY 'software_subscription',
        BINARY 'transportation', BINARY 'meals_hospitality',
        BINARY 'marketing', BINARY 'office', BINARY 'external_service',
        BINARY 'tax_fee', BINARY 'other'
      )`,
    ),
    check(
      "chk_expense_description",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})`,
    ),
    check(
      "chk_expense_optional_text",
      sql`(${table.vendorName} IS NULL OR (
          CHAR_LENGTH(${table.vendorName}) BETWEEN 1 AND 191
          AND ${table.vendorName} = TRIM(${table.vendorName})
        ))
        AND (${table.documentNumber} IS NULL OR (
          CHAR_LENGTH(${table.documentNumber}) BETWEEN 1 AND 64
          AND ${table.documentNumber} = TRIM(${table.documentNumber})
        ))
        AND (${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_expense_document",
      sql`(${table.documentType} IS NULL AND ${table.documentNumber} IS NULL)
        OR (${table.documentType} IS NOT NULL AND BINARY ${table.documentType} IN (
          BINARY 'invoice', BINARY 'receipt', BINARY 'other'
        ))`,
    ),
    check(
      "chk_expense_payment_shape",
      sql`(
          BINARY ${table.paymentMethod} = BINARY 'credit_card'
          AND ${table.creditCardId} IS NOT NULL
          AND ${table.installmentCount} BETWEEN 1 AND 36
        ) OR (
          BINARY ${table.paymentMethod} IN (
            BINARY 'cash', BINARY 'bank_transfer', BINARY 'other'
          )
          AND ${table.creditCardId} IS NULL
          AND ${table.installmentCount} = 1
        )`,
    ),
    check(
      "chk_expense_amounts",
      sql`${table.netAmount} >= 0
        AND ${table.vatAmount} >= 0
        AND ${table.totalAmount} > 0
        AND ${table.totalAmount} = ${table.netAmount} + ${table.vatAmount}
        AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_expense_status",
      sql`BINARY ${table.status} IN (BINARY 'active', BINARY 'voided')`,
    ),
    check(
      "chk_expense_void_shape",
      sql`(
          BINARY ${table.status} = BINARY 'active'
          AND ${table.voidReason} IS NULL
          AND ${table.voidedAtUtc} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'voided'
          AND ${table.voidReason} IS NOT NULL
          AND CHAR_LENGTH(TRIM(${table.voidReason})) BETWEEN 1 AND 2000
          AND ${table.voidedAtUtc} IS NOT NULL
        )`,
    ),
    check("chk_expense_version", sql`${table.version} >= 1`),
    check(
      "chk_expense_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}
        AND (
          ${table.voidedAtUtc} IS NULL
          OR (
            ${table.createdAtUtc} <= ${table.voidedAtUtc}
            AND ${table.voidedAtUtc} <= ${table.updatedAtUtc}
          )
        )`,
    ),
    foreignKey({
      name: "fk_expense_project",
      columns: [table.projectId],
      foreignColumns: [project.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_expense_credit_card",
      columns: [table.creditCardId],
      foreignColumns: [creditCard.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_expense_client_operation").on(table.clientOperationKey),
    index("idx_expense_project_date").on(
      table.projectId,
      table.incurredOn,
      table.id,
    ),
    index("idx_expense_card_date").on(
      table.creditCardId,
      table.incurredOn,
      table.id,
    ),
    index("idx_expense_status_date").on(
      table.status,
      table.incurredOn,
      table.id,
    ),
  ],
);

export const creditCardInstallment = mysqlTable(
  "credit_card_installment",
  {
    id: char("id", { length: 36 }).primaryKey(),
    expenseId: char("expense_id", { length: 36 }).notNull(),
    installmentNumber: smallint("installment_number", {
      unsigned: true,
    }).notNull(),
    installmentCount: smallint("installment_count", {
      unsigned: true,
    }).notNull(),
    statementMonth: date("statement_month", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    amount: decimal("amount", { precision: 19, scale: 4 }).notNull(),
    status: varchar("status", { length: 16 }).default("planned").notNull(),
    paidOn: date("paid_on", { mode: "string" }),
    version: int("version", { unsigned: true }).default(1).notNull(),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
    updatedAtUtc: datetime("updated_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_credit_card_installment_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.expenseId}) = 36
        AND BINARY ${table.expenseId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_credit_card_installment_sequence",
      sql`${table.installmentNumber} BETWEEN 1 AND ${table.installmentCount}
        AND ${table.installmentCount} BETWEEN 1 AND 36`,
    ),
    check(
      "chk_credit_card_installment_schedule",
      sql`DAYOFMONTH(${table.statementMonth}) = 1
        AND ${table.statementMonth} <= ${table.dueOn}
        AND ${table.amount} > 0`,
    ),
    check(
      "chk_credit_card_installment_payment",
      sql`(
          BINARY ${table.status} = BINARY 'planned'
          AND ${table.paidOn} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'paid'
          AND ${table.paidOn} IS NOT NULL
        )`,
    ),
    check("chk_credit_card_installment_version", sql`${table.version} >= 1`),
    check(
      "chk_credit_card_installment_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_credit_card_installment_expense",
      columns: [table.expenseId],
      foreignColumns: [expense.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_credit_card_installment_expense_no").on(
      table.expenseId,
      table.installmentNumber,
    ),
    index("idx_credit_card_installment_due_status").on(
      table.status,
      table.dueOn,
      table.id,
    ),
    index("idx_credit_card_installment_statement").on(
      table.statementMonth,
      table.status,
      table.dueOn,
    ),
  ],
);

export type CreditCardRecord = typeof creditCard.$inferSelect;
export type NewCreditCardRecord = typeof creditCard.$inferInsert;
export type ExpenseRecord = typeof expense.$inferSelect;
export type NewExpenseRecord = typeof expense.$inferInsert;
export type CreditCardInstallmentRecord =
  typeof creditCardInstallment.$inferSelect;
export type NewCreditCardInstallmentRecord =
  typeof creditCardInstallment.$inferInsert;
