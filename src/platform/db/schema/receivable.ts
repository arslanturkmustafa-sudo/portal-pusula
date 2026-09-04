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

import { consultingContract } from "./consulting-contract";
import { customer } from "./customer";
import { customerProject } from "./customer-project";

export const receivable = mysqlTable(
  "receivable",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }),
    customerId: char("customer_id", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }),
    contractId: char("contract_id", { length: 36 }),
    sourceType: varchar("source_type", { length: 24 }).notNull(),
    periodMonth: date("period_month", { mode: "string" }),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    netAmount: decimal("net_amount", { precision: 19, scale: 4 }).notNull(),
    vatAmount: decimal("vat_amount", { precision: 19, scale: 4 }).notNull(),
    totalAmount: decimal("total_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    recordState: varchar("record_state", { length: 16 })
      .default("active")
      .notNull(),
    voidReason: varchar("void_reason", { length: 2000 }),
    voidedAtUtc: datetime("voided_at_utc", { fsp: 6, mode: "string" }),
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
      "chk_receivable_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.customerId}) = 36
        AND BINARY ${table.customerId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (${table.clientOperationKey} IS NULL OR (
          OCTET_LENGTH(${table.clientOperationKey}) = 36
          AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (${table.contractId} IS NULL OR (
          OCTET_LENGTH(${table.contractId}) = 36
          AND BINARY ${table.contractId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))`,
    ),
    check(
      "chk_receivable_source",
      sql`(
          BINARY ${table.sourceType} = BINARY 'contract_month'
          AND ${table.contractId} IS NOT NULL
          AND ${table.clientOperationKey} IS NULL
          AND ${table.periodMonth} IS NOT NULL
          AND DAYOFMONTH(${table.periodMonth}) = 1
        ) OR (
          BINARY ${table.sourceType} = BINARY 'opening_balance'
          AND ${table.clientOperationKey} IS NOT NULL
          AND ${table.contractId} IS NULL
          AND ${table.periodMonth} IS NULL
        )`,
    ),
    check(
      "chk_receivable_amounts",
      sql`${table.netAmount} >= 0
        AND ${table.vatAmount} >= 0
        AND ${table.totalAmount} > 0
        AND ${table.totalAmount} = ${table.netAmount} + ${table.vatAmount}
        AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_receivable_description",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})`,
    ),
    check(
      "chk_receivable_record_state",
      sql`BINARY ${table.recordState} IN (BINARY 'active', BINARY 'voided')`,
    ),
    check(
      "chk_receivable_void_shape",
      sql`(
          BINARY ${table.recordState} = BINARY 'active'
          AND ${table.voidReason} IS NULL
          AND ${table.voidedAtUtc} IS NULL
        ) OR (
          BINARY ${table.recordState} = BINARY 'voided'
          AND ${table.voidReason} IS NOT NULL
          AND CHAR_LENGTH(${table.voidReason}) BETWEEN 1 AND 2000
          AND ${table.voidReason} = TRIM(${table.voidReason})
          AND ${table.voidedAtUtc} IS NOT NULL
        )`,
    ),
    check("chk_receivable_version", sql`${table.version} >= 1`),
    check(
      "chk_receivable_timeline",
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
      name: "fk_receivable_customer",
      columns: [table.customerId],
      foreignColumns: [customer.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_receivable_customer_project",
      columns: [table.customerId, table.projectId],
      foreignColumns: [customerProject.customerId, customerProject.projectId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_receivable_contract",
      columns: [table.contractId],
      foreignColumns: [consultingContract.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_receivable_contract_month").on(
      table.contractId,
      table.sourceType,
      table.periodMonth,
    ),
    uniqueIndex("uq_receivable_opening_operation").on(
      table.clientOperationKey,
    ),
    index("idx_receivable_due_on").on(table.dueOn, table.customerId),
    index("idx_receivable_state_due").on(
      table.recordState,
      table.dueOn,
      table.customerId,
    ),
    index("idx_receivable_customer_created").on(
      table.customerId,
      table.createdAtUtc,
    ),
    index("idx_receivable_customer_project").on(
      table.customerId,
      table.projectId,
    ),
    index("idx_receivable_project_due").on(
      table.projectId,
      table.dueOn,
      table.customerId,
    ),
  ],
);

export const receivableCollection = mysqlTable(
  "receivable_collection",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    receivableId: char("receivable_id", { length: 36 }).notNull(),
    amount: decimal("amount", { precision: 19, scale: 4 }).notNull(),
    collectedOn: date("collected_on", { mode: "string" }).notNull(),
    entryType: varchar("entry_type", { length: 16 })
      .default("collection")
      .notNull(),
    reversalOfId: char("reversal_of_id", { length: 36 }),
    reversalReason: varchar("reversal_reason", { length: 2000 }),
    note: varchar("note", { length: 2000 }),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table): MySqlTableExtraConfigValue[] => [
    check(
      "chk_receivable_collection_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.receivableId}) = 36
        AND BINARY ${table.receivableId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (${table.reversalOfId} IS NULL OR (
          OCTET_LENGTH(${table.reversalOfId}) = 36
          AND BINARY ${table.reversalOfId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))`,
    ),
    check(
      "chk_receivable_collection_amount",
      sql`${table.amount} > 0`,
    ),
    check(
      "chk_receivable_collection_optional_fields",
      sql`${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000`,
    ),
    check(
      "chk_receivable_collection_entry",
      sql`(
          BINARY ${table.entryType} = BINARY 'collection'
          AND ${table.reversalOfId} IS NULL
          AND ${table.reversalReason} IS NULL
        ) OR (
          BINARY ${table.entryType} = BINARY 'reversal'
          AND ${table.reversalOfId} IS NOT NULL
          AND ${table.reversalReason} IS NOT NULL
          AND CHAR_LENGTH(${table.reversalReason}) BETWEEN 1 AND 2000
          AND ${table.reversalReason} = TRIM(${table.reversalReason})
        )`,
    ),
    foreignKey({
      name: "fk_receivable_collection_receivable",
      columns: [table.receivableId],
      foreignColumns: [receivable.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_receivable_collection_reversal",
      columns: [table.reversalOfId],
      foreignColumns: [receivableCollection.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_receivable_collection_operation").on(
      table.clientOperationKey,
    ),
    uniqueIndex("uq_receivable_collection_reversal").on(table.reversalOfId),
    index("idx_receivable_collection_receivable_date").on(
      table.receivableId,
      table.collectedOn,
      table.createdAtUtc,
    ),
  ],
);

export type ReceivableRecord = typeof receivable.$inferSelect;
export type NewReceivableRecord = typeof receivable.$inferInsert;
export type ReceivableCollectionRecord =
  typeof receivableCollection.$inferSelect;
export type NewReceivableCollectionRecord =
  typeof receivableCollection.$inferInsert;
