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
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { project } from "./project";

export const partnershipCommission = mysqlTable(
  "partnership_commission",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }).notNull(),
    transactionType: varchar("transaction_type", { length: 16 }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    closedOn: date("closed_on", { mode: "string" }).notNull(),
    commissionBasisAmount: decimal("commission_basis_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    contributionMode: varchar("contribution_mode", { length: 24 }).notNull(),
    shareRate: decimal("share_rate", { precision: 5, scale: 4 }).notNull(),
    shareAmount: decimal("share_amount", { precision: 19, scale: 4 }).notNull(),
    status: varchar("status", { length: 24 }).default("expected").notNull(),
    agencyCollectedOn: date("agency_collected_on", { mode: "string" }),
    paidOn: date("paid_on", { mode: "string" }),
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
      "chk_partnership_commission_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.projectId}) = 36
        AND BINARY ${table.projectId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_partnership_commission_kind",
      sql`BINARY ${table.transactionType} IN (BINARY 'sale', BINARY 'rental')
        AND BINARY ${table.contributionMode} IN (
          BINARY 'partner_only', BINARY 'user_one_side', BINARY 'user_both'
        )`,
    ),
    check(
      "chk_partnership_commission_text",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})
        AND (${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_partnership_commission_amount",
      sql`${table.commissionBasisAmount} > 0
        AND ${table.shareRate} IN (0.1000, 0.2500, 0.5000)
        AND ${table.shareAmount} = ROUND(${table.commissionBasisAmount} * ${table.shareRate}, 4)`,
    ),
    check(
      "chk_partnership_commission_rate",
      sql`(
          BINARY ${table.contributionMode} = BINARY 'partner_only'
          AND ${table.shareRate} = 0.1000
        ) OR (
          BINARY ${table.contributionMode} = BINARY 'user_one_side'
          AND ${table.shareRate} = 0.2500
        ) OR (
          BINARY ${table.contributionMode} = BINARY 'user_both'
          AND ${table.shareRate} = 0.5000
        )`,
    ),
    check(
      "chk_partnership_commission_status",
      sql`BINARY ${table.status} IN (
        BINARY 'expected', BINARY 'agency_collected', BINARY 'paid',
        BINARY 'cancelled'
      )`,
    ),
    check(
      "chk_partnership_commission_payment",
      sql`(
          BINARY ${table.status} IN (BINARY 'expected', BINARY 'cancelled')
          AND ${table.agencyCollectedOn} IS NULL
          AND ${table.paidOn} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'agency_collected'
          AND ${table.agencyCollectedOn} IS NOT NULL
          AND ${table.closedOn} <= ${table.agencyCollectedOn}
          AND ${table.paidOn} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'paid'
          AND ${table.agencyCollectedOn} IS NOT NULL
          AND ${table.paidOn} IS NOT NULL
          AND ${table.closedOn} <= ${table.agencyCollectedOn}
          AND ${table.agencyCollectedOn} <= ${table.paidOn}
        )`,
    ),
    check("chk_partnership_commission_version", sql`${table.version} >= 1`),
    check(
      "chk_partnership_commission_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_partnership_commission_project",
      columns: [table.projectId],
      foreignColumns: [project.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_partnership_commission_operation").on(
      table.clientOperationKey,
    ),
    index("idx_partnership_commission_project_status_date").on(
      table.projectId,
      table.status,
      table.closedOn,
      table.id,
    ),
  ],
);

export const partnershipContribution = mysqlTable(
  "partnership_contribution",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }).notNull(),
    contributionMonth: date("contribution_month", { mode: "string" }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    expectedAmount: decimal("expected_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    receivedAmount: decimal("received_amount", { precision: 19, scale: 4 })
      .default("0.0000")
      .notNull(),
    receivedOn: date("received_on", { mode: "string" }),
    status: varchar("status", { length: 16 }).default("expected").notNull(),
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
      "chk_partnership_contribution_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.projectId}) = 36
        AND BINARY ${table.projectId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_partnership_contribution_text",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})
        AND (${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_partnership_contribution_period",
      sql`DAYOFMONTH(${table.contributionMonth}) = 1
        AND ${table.contributionMonth} <= ${table.dueOn}`,
    ),
    check(
      "chk_partnership_contribution_amount",
      sql`${table.expectedAmount} > 0
        AND ${table.receivedAmount} >= 0
        AND ${table.receivedAmount} <= ${table.expectedAmount}`,
    ),
    check(
      "chk_partnership_contribution_status",
      sql`(
          BINARY ${table.status} = BINARY 'expected'
          AND ${table.receivedAmount} = 0
          AND ${table.receivedOn} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'partial'
          AND ${table.receivedAmount} > 0
          AND ${table.receivedAmount} < ${table.expectedAmount}
          AND ${table.receivedOn} IS NOT NULL
        ) OR (
          BINARY ${table.status} = BINARY 'received'
          AND ${table.receivedAmount} = ${table.expectedAmount}
          AND ${table.receivedOn} IS NOT NULL
        ) OR (
          BINARY ${table.status} = BINARY 'cancelled'
          AND ${table.receivedAmount} = 0
          AND ${table.receivedOn} IS NULL
        )`,
    ),
    check("chk_partnership_contribution_version", sql`${table.version} >= 1`),
    check(
      "chk_partnership_contribution_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_partnership_contribution_project",
      columns: [table.projectId],
      foreignColumns: [project.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_partnership_contribution_operation").on(
      table.clientOperationKey,
    ),
    uniqueIndex("uq_partnership_contribution_month").on(
      table.projectId,
      table.contributionMonth,
    ),
    index("idx_partnership_contribution_project_status_due").on(
      table.projectId,
      table.status,
      table.dueOn,
      table.id,
    ),
  ],
);

export const partnershipContributionReceipt = mysqlTable(
  "partnership_contribution_receipt",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    contributionId: char("contribution_id", { length: 36 }).notNull(),
    amount: decimal("amount", { precision: 19, scale: 4 }).notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    note: varchar("note", { length: 2000 }),
    createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    check(
      "chk_partnership_contribution_receipt_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.contributionId}) = 36
        AND BINARY ${table.contributionId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_partnership_contribution_receipt_amount",
      sql`${table.amount} > 0`,
    ),
    check(
      "chk_partnership_contribution_receipt_note",
      sql`${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000`,
    ),
    foreignKey({
      name: "fk_partnership_contribution_receipt_contribution",
      columns: [table.contributionId],
      foreignColumns: [partnershipContribution.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_partnership_contribution_receipt_operation").on(
      table.clientOperationKey,
    ),
    index("idx_partnership_contribution_receipt_parent_date").on(
      table.contributionId,
      table.receivedOn,
      table.id,
    ),
  ],
);

export type PartnershipCommissionRecord =
  typeof partnershipCommission.$inferSelect;
export type NewPartnershipCommissionRecord =
  typeof partnershipCommission.$inferInsert;
export type PartnershipContributionRecord =
  typeof partnershipContribution.$inferSelect;
export type NewPartnershipContributionRecord =
  typeof partnershipContribution.$inferInsert;
export type PartnershipContributionReceiptRecord =
  typeof partnershipContributionReceipt.$inferSelect;
export type NewPartnershipContributionReceiptRecord =
  typeof partnershipContributionReceipt.$inferInsert;
