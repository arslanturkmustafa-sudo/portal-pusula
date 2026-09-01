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
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { customer } from "./customer";

export const consultingContract = mysqlTable(
  "consulting_contract",
  {
    id: char("id", { length: 36 }).primaryKey(),
    customerId: char("customer_id", { length: 36 }).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    monthlyFeeAmount: decimal("monthly_fee_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    vatMode: varchar("vat_mode", { length: 16 }).notNull(),
    vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull(),
    paymentDay: int("payment_day", { unsigned: true }).notNull(),
    internalNote: varchar("internal_note", { length: 2000 }),
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
      "chk_consulting_contract_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.customerId}) = 36
        AND BINARY ${table.customerId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_consulting_contract_status",
      sql`BINARY ${table.status} IN (BINARY 'draft', BINARY 'active', BINARY 'closed')`,
    ),
    check(
      "chk_consulting_contract_terms",
      sql`${table.startsOn} <= ${table.endsOn}
        AND ${table.monthlyFeeAmount} > 0
        AND BINARY ${table.currency} = BINARY 'TRY'
        AND BINARY ${table.vatMode} IN (BINARY 'exempt', BINARY 'exclusive', BINARY 'inclusive')
        AND (
          (${table.vatMode} = 'exempt' AND ${table.vatRate} = 0)
          OR (${table.vatMode} IN ('exclusive', 'inclusive') AND ${table.vatRate} > 0 AND ${table.vatRate} <= 100)
        )
        AND ${table.paymentDay} BETWEEN 1 AND 31`,
    ),
    check(
      "chk_consulting_contract_optional_fields",
      sql`${table.internalNote} IS NULL OR CHAR_LENGTH(${table.internalNote}) BETWEEN 1 AND 2000`,
    ),
    check(
      "chk_consulting_contract_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_consulting_contract_customer",
      columns: [table.customerId],
      foreignColumns: [customer.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_consulting_contract_customer_start").on(
      table.customerId,
      table.startsOn,
    ),
    index("idx_consulting_contract_customer_status").on(
      table.customerId,
      table.status,
      table.endsOn,
    ),
  ],
);

export const monthlyVisitCommitment = mysqlTable(
  "monthly_visit_commitment",
  {
    id: char("id", { length: 36 }).primaryKey(),
    contractId: char("contract_id", { length: 36 }).notNull(),
    committedOn: date("committed_on", { mode: "string" }).notNull(),
    resolutionStatus: varchar("resolution_status", { length: 32 })
      .default("planned")
      .notNull(),
    internalPlannedAtUtc: datetime("internal_planned_at_utc", {
      fsp: 6,
      mode: "string",
    }),
    internalDurationMinutes: smallint("internal_duration_minutes", {
      unsigned: true,
    }),
    deliveredOn: date("delivered_on", { mode: "string" }),
    resolutionNote: varchar("resolution_note", { length: 2000 }),
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
      "chk_monthly_visit_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.contractId}) = 36
        AND BINARY ${table.contractId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_monthly_visit_status",
      sql`BINARY ${table.resolutionStatus} IN (
        BINARY 'planned', BINARY 'completed', BINARY 'makeup_pending',
        BINARY 'cancelled_by_agreement'
      )`,
    ),
    check(
      "chk_monthly_visit_internal_plan",
      sql`(
        ${table.internalPlannedAtUtc} IS NULL
        AND ${table.internalDurationMinutes} IS NULL
      ) OR (
        ${table.internalPlannedAtUtc} IS NOT NULL
        AND ${table.internalDurationMinutes} IS NOT NULL
        AND ${table.internalDurationMinutes} BETWEEN 15 AND 720
      )`,
    ),
    check(
      "chk_monthly_visit_resolution",
      sql`(
        ${table.resolutionStatus} = 'completed'
        AND ${table.deliveredOn} IS NOT NULL
        AND EXTRACT(YEAR_MONTH FROM ${table.deliveredOn}) = EXTRACT(YEAR_MONTH FROM ${table.committedOn})
      ) OR (
        ${table.resolutionStatus} <> 'completed'
        AND ${table.deliveredOn} IS NULL
      )`,
    ),
    check(
      "chk_monthly_visit_cancellation_note",
      sql`${table.resolutionStatus} <> 'cancelled_by_agreement'
        OR (
          ${table.resolutionNote} IS NOT NULL
          AND CHAR_LENGTH(${table.resolutionNote}) BETWEEN 1 AND 2000
        )`,
    ),
    check(
      "chk_monthly_visit_optional_fields",
      sql`${table.resolutionNote} IS NULL OR CHAR_LENGTH(${table.resolutionNote}) BETWEEN 1 AND 2000`,
    ),
    check(
      "chk_monthly_visit_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_monthly_visit_contract",
      columns: [table.contractId],
      foreignColumns: [consultingContract.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_monthly_visit_contract_day").on(
      table.contractId,
      table.committedOn,
    ),
    index("idx_monthly_visit_contract_month").on(
      table.contractId,
      table.committedOn,
      table.resolutionStatus,
    ),
  ],
);

export type ConsultingContractRecord = typeof consultingContract.$inferSelect;
export type NewConsultingContractRecord = typeof consultingContract.$inferInsert;
export type MonthlyVisitCommitmentRecord =
  typeof monthlyVisitCommitment.$inferSelect;
export type NewMonthlyVisitCommitmentRecord =
  typeof monthlyVisitCommitment.$inferInsert;
