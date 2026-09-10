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
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { financeAccount } from "./finance-account";
import { creditCard, expenseCategory } from "./finance-spending";
import { project } from "./project";

export const recurringExpense = mysqlTable(
  "recurring_expense",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }),
    creditCardId: char("credit_card_id", { length: 36 }),
    sourceAccountId: char("source_account_id", { length: 36 }),
    category: varchar("category", { length: 32 }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    vendorName: varchar("vendor_name", { length: 191 }),
    paymentMethod: varchar("payment_method", { length: 24 }).notNull(),
    netAmount: decimal("net_amount", { precision: 19, scale: 4 }).notNull(),
    vatAmount: decimal("vat_amount", { precision: 19, scale: 4 }).notNull(),
    totalAmount: decimal("total_amount", { precision: 19, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    frequency: varchar("frequency", { length: 16 }).notNull(),
    anchorDay: tinyint("anchor_day", { unsigned: true }).notNull(),
    nextDueOn: date("next_due_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    note: varchar("note", { length: 2000 }),
    version: int("version", { unsigned: true }).default(1).notNull(),
    createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
    updatedAtUtc: datetime("updated_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_recurring_expense_identity",
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
        ))
        AND (${table.sourceAccountId} IS NULL OR (
          OCTET_LENGTH(${table.sourceAccountId}) = 36
          AND BINARY ${table.sourceAccountId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))`,
    ),
    check(
      "chk_recurring_expense_category",
      sql`CHAR_LENGTH(${table.category}) BETWEEN 1 AND 32
        AND BINARY ${table.category} REGEXP '^[a-z][a-z0-9_]{0,31}$'`,
    ),
    check(
      "chk_recurring_expense_text",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})
        AND (${table.vendorName} IS NULL OR (
          CHAR_LENGTH(${table.vendorName}) BETWEEN 1 AND 191
          AND ${table.vendorName} = TRIM(${table.vendorName})
        ))
        AND (${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_recurring_expense_payment_shape",
      sql`(
          BINARY ${table.paymentMethod} = BINARY 'credit_card'
          AND ${table.creditCardId} IS NOT NULL
          AND ${table.sourceAccountId} IS NULL
        ) OR (
          BINARY ${table.paymentMethod} IN (BINARY 'cash', BINARY 'bank_transfer')
          AND ${table.creditCardId} IS NULL
          AND ${table.sourceAccountId} IS NOT NULL
        ) OR (
          BINARY ${table.paymentMethod} = BINARY 'other'
          AND ${table.creditCardId} IS NULL
          AND ${table.sourceAccountId} IS NULL
        )`,
    ),
    check(
      "chk_recurring_expense_amounts",
      sql`${table.netAmount} >= 0
        AND ${table.vatAmount} >= 0
        AND ${table.totalAmount} > 0
        AND ${table.totalAmount} = ${table.netAmount} + ${table.vatAmount}
        AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_recurring_expense_schedule",
      sql`BINARY ${table.frequency} IN (BINARY 'weekly', BINARY 'monthly')
        AND ${table.anchorDay} BETWEEN 1 AND 31
        AND (
          BINARY ${table.status} = BINARY 'paused'
          OR ${table.endsOn} IS NULL
          OR ${table.nextDueOn} <= ${table.endsOn}
        )`,
    ),
    check(
      "chk_recurring_expense_status",
      sql`BINARY ${table.status} IN (BINARY 'active', BINARY 'paused')`,
    ),
    check("chk_recurring_expense_version", sql`${table.version} >= 1`),
    check(
      "chk_recurring_expense_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_recurring_expense_project",
      columns: [table.projectId],
      foreignColumns: [project.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_recurring_expense_credit_card",
      columns: [table.creditCardId],
      foreignColumns: [creditCard.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_recurring_expense_source_account",
      columns: [table.sourceAccountId],
      foreignColumns: [financeAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_recurring_expense_category",
      columns: [table.category],
      foreignColumns: [expenseCategory.code],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_recurring_expense_client_operation").on(
      table.clientOperationKey,
    ),
    index("idx_recurring_expense_status_due").on(
      table.status,
      table.nextDueOn,
      table.id,
    ),
    index("idx_recurring_expense_project_due").on(
      table.projectId,
      table.nextDueOn,
      table.id,
    ),
  ],
);

export type RecurringExpenseRecord = typeof recurringExpense.$inferSelect;
export type NewRecurringExpenseRecord = typeof recurringExpense.$inferInsert;
