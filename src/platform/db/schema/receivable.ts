import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  datetime,
  decimal,
  foreignKey,
  index,
  mysqlTable,
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
      "chk_receivable_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
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
    note: varchar("note", { length: 2000 }),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_receivable_collection_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.receivableId}) = 36
        AND BINARY ${table.receivableId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_receivable_collection_amount",
      sql`${table.amount} > 0`,
    ),
    check(
      "chk_receivable_collection_optional_fields",
      sql`${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000`,
    ),
    foreignKey({
      name: "fk_receivable_collection_receivable",
      columns: [table.receivableId],
      foreignColumns: [receivable.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_receivable_collection_operation").on(
      table.clientOperationKey,
    ),
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
