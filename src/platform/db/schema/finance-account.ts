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
  type MySqlTableExtraConfigValue,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const financeAccount = mysqlTable(
  "finance_account",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    accountType: varchar("account_type", { length: 16 }).notNull(),
    displayName: varchar("display_name", { length: 191 }).notNull(),
    bankName: varchar("bank_name", { length: 191 }),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    openingBalanceAmount: decimal("opening_balance_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
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
      "chk_finance_account_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_finance_account_type",
      sql`BINARY ${table.accountType} IN (BINARY 'cash', BINARY 'bank')`,
    ),
    check(
      "chk_finance_account_display_name",
      sql`CHAR_LENGTH(${table.displayName}) BETWEEN 1 AND 191
        AND ${table.displayName} = TRIM(${table.displayName})`,
    ),
    check(
      "chk_finance_account_bank_shape",
      sql`(
          BINARY ${table.accountType} = BINARY 'cash'
          AND ${table.bankName} IS NULL
        ) OR (
          BINARY ${table.accountType} = BINARY 'bank'
          AND (
            ${table.bankName} IS NULL
            OR (
              CHAR_LENGTH(${table.bankName}) BETWEEN 1 AND 191
              AND ${table.bankName} = TRIM(${table.bankName})
            )
          )
        )`,
    ),
    check(
      "chk_finance_account_currency",
      sql`BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_finance_account_status",
      sql`BINARY ${table.status} IN (BINARY 'active', BINARY 'inactive')`,
    ),
    check("chk_finance_account_version", sql`${table.version} >= 1`),
    check(
      "chk_finance_account_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    uniqueIndex("uq_finance_account_client_operation").on(
      table.clientOperationKey,
    ),
    index("idx_finance_account_status_type_name").on(
      table.status,
      table.accountType,
      table.displayName,
    ),
  ],
);

export const financeTransaction = mysqlTable(
  "finance_transaction",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    transactionType: varchar("transaction_type", { length: 16 }).notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    amount: decimal("amount", { precision: 19, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    sourceAccountId: char("source_account_id", { length: 36 }),
    targetAccountId: char("target_account_id", { length: 36 }),
    reversalOfId: char("reversal_of_id", { length: 36 }),
    reversalReason: varchar("reversal_reason", { length: 2000 }),
    createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table): MySqlTableExtraConfigValue[] => [
    check(
      "chk_finance_transaction_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (${table.sourceAccountId} IS NULL OR (
          OCTET_LENGTH(${table.sourceAccountId}) = 36
          AND BINARY ${table.sourceAccountId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (${table.targetAccountId} IS NULL OR (
          OCTET_LENGTH(${table.targetAccountId}) = 36
          AND BINARY ${table.targetAccountId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (${table.reversalOfId} IS NULL OR (
          OCTET_LENGTH(${table.reversalOfId}) = 36
          AND BINARY ${table.reversalOfId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))`,
    ),
    check(
      "chk_finance_transaction_shape",
      sql`(
          BINARY ${table.transactionType} = BINARY 'income'
          AND ${table.sourceAccountId} IS NULL
          AND ${table.targetAccountId} IS NOT NULL
        ) OR (
          BINARY ${table.transactionType} = BINARY 'expense'
          AND ${table.sourceAccountId} IS NOT NULL
          AND ${table.targetAccountId} IS NULL
        ) OR (
          BINARY ${table.transactionType} = BINARY 'transfer'
          AND ${table.sourceAccountId} IS NOT NULL
          AND ${table.targetAccountId} IS NOT NULL
          AND BINARY ${table.sourceAccountId} <> BINARY ${table.targetAccountId}
        )`,
    ),
    check(
      "chk_finance_transaction_description",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})`,
    ),
    check(
      "chk_finance_transaction_amount",
      sql`${table.amount} > 0 AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_finance_transaction_reversal",
      sql`(
          ${table.reversalOfId} IS NULL
          AND ${table.reversalReason} IS NULL
        ) OR (
          ${table.reversalOfId} IS NOT NULL
          AND BINARY ${table.reversalOfId} <> BINARY ${table.id}
          AND ${table.reversalReason} IS NOT NULL
          AND CHAR_LENGTH(${table.reversalReason}) BETWEEN 1 AND 2000
          AND ${table.reversalReason} = TRIM(${table.reversalReason})
        )`,
    ),
    foreignKey({
      name: "fk_finance_transaction_source_account",
      columns: [table.sourceAccountId],
      foreignColumns: [financeAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_finance_transaction_target_account",
      columns: [table.targetAccountId],
      foreignColumns: [financeAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_finance_transaction_reversal",
      columns: [table.reversalOfId],
      foreignColumns: [financeTransaction.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_finance_transaction_client_operation").on(
      table.clientOperationKey,
    ),
    uniqueIndex("uq_finance_transaction_reversal").on(table.reversalOfId),
    index("idx_finance_transaction_occurred").on(
      table.occurredOn,
      table.createdAtUtc,
      table.id,
    ),
    index("idx_finance_transaction_source_occurred").on(
      table.sourceAccountId,
      table.occurredOn,
    ),
    index("idx_finance_transaction_target_occurred").on(
      table.targetAccountId,
      table.occurredOn,
    ),
  ],
);

export const financeLedgerEntry = mysqlTable(
  "finance_ledger_entry",
  {
    id: char("id", { length: 36 }).primaryKey(),
    transactionId: char("transaction_id", { length: 36 }).notNull(),
    accountId: char("account_id", { length: 36 }).notNull(),
    entrySide: varchar("entry_side", { length: 16 }).notNull(),
    amount: decimal("amount", { precision: 19, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_finance_ledger_entry_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.transactionId}) = 36
        AND BINARY ${table.transactionId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.accountId}) = 36
        AND BINARY ${table.accountId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_finance_ledger_entry_side",
      sql`BINARY ${table.entrySide} IN (BINARY 'inflow', BINARY 'outflow')`,
    ),
    check(
      "chk_finance_ledger_entry_amount",
      sql`${table.amount} > 0 AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    foreignKey({
      name: "fk_finance_ledger_entry_transaction",
      columns: [table.transactionId],
      foreignColumns: [financeTransaction.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_finance_ledger_entry_account",
      columns: [table.accountId],
      foreignColumns: [financeAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_finance_ledger_transaction_side").on(
      table.transactionId,
      table.entrySide,
    ),
    uniqueIndex("uq_finance_ledger_transaction_account").on(
      table.transactionId,
      table.accountId,
    ),
    index("idx_finance_ledger_account_created").on(
      table.accountId,
      table.createdAtUtc,
      table.id,
    ),
  ],
);

export type FinanceAccountRecord = typeof financeAccount.$inferSelect;
export type NewFinanceAccountRecord = typeof financeAccount.$inferInsert;
export type FinanceTransactionRecord = typeof financeTransaction.$inferSelect;
export type NewFinanceTransactionRecord = typeof financeTransaction.$inferInsert;
export type FinanceLedgerEntryRecord = typeof financeLedgerEntry.$inferSelect;
export type NewFinanceLedgerEntryRecord = typeof financeLedgerEntry.$inferInsert;
