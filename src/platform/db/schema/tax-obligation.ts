import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  datetime,
  decimal,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const taxObligation = mysqlTable(
  "tax_obligation",
  {
    id: char("id", { length: 36 }).primaryKey(),
    clientOperationKey: char("client_operation_key", { length: 36 }).notNull(),
    taxType: varchar("tax_type", { length: 24 }).notNull(),
    periodMonth: date("period_month", { mode: "string" }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    systemOutputVatAmount: decimal("system_output_vat_amount", {
      precision: 19,
      scale: 4,
    })
      .default("0.0000")
      .notNull(),
    systemInputVatAmount: decimal("system_input_vat_amount", {
      precision: 19,
      scale: 4,
    })
      .default("0.0000")
      .notNull(),
    carriedVatCreditAmount: decimal("carried_vat_credit_amount", {
      precision: 19,
      scale: 4,
    })
      .default("0.0000")
      .notNull(),
    manualAdjustmentAmount: decimal("manual_adjustment_amount", {
      precision: 19,
      scale: 4,
    })
      .default("0.0000")
      .notNull(),
    payableAmount: decimal("payable_amount", {
      precision: 19,
      scale: 4,
    }).notNull(),
    closingVatCreditAmount: decimal("closing_vat_credit_amount", {
      precision: 19,
      scale: 4,
    })
      .default("0.0000")
      .notNull(),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    status: varchar("status", { length: 16 }).default("planned").notNull(),
    paidOn: date("paid_on", { mode: "string" }),
    note: varchar("note", { length: 2000 }),
    voidReason: varchar("void_reason", { length: 2000 }),
    voidedAtUtc: datetime("voided_at_utc", { fsp: 6, mode: "string" }),
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
      "chk_tax_obligation_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.clientOperationKey}) = 36
        AND BINARY ${table.clientOperationKey} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_tax_obligation_type_period",
      sql`BINARY ${table.taxType} IN (
          BINARY 'vat', BINARY 'income_tax', BINARY 'provisional_tax'
        )
        AND DAYOFMONTH(${table.periodMonth}) = 1`,
    ),
    check(
      "chk_tax_obligation_text",
      sql`CHAR_LENGTH(${table.description}) BETWEEN 1 AND 191
        AND ${table.description} = TRIM(${table.description})
        AND (${table.note} IS NULL OR CHAR_LENGTH(${table.note}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_tax_obligation_amounts",
      sql`${table.systemOutputVatAmount} >= 0
        AND ${table.systemInputVatAmount} >= 0
        AND ${table.carriedVatCreditAmount} >= 0
        AND ${table.payableAmount} >= 0
        AND ${table.closingVatCreditAmount} >= 0
        AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_tax_obligation_tax_shape",
      sql`(
          BINARY ${table.taxType} = BINARY 'vat'
          AND ${table.payableAmount} = GREATEST(
            ${table.systemOutputVatAmount} - ${table.systemInputVatAmount}
              - ${table.carriedVatCreditAmount} + ${table.manualAdjustmentAmount},
            0
          )
          AND ${table.closingVatCreditAmount} = GREATEST(
            0 - (
              ${table.systemOutputVatAmount} - ${table.systemInputVatAmount}
                - ${table.carriedVatCreditAmount} + ${table.manualAdjustmentAmount}
            ),
            0
          )
        ) OR (
          BINARY ${table.taxType} IN (
            BINARY 'income_tax', BINARY 'provisional_tax'
          )
          AND ${table.systemOutputVatAmount} = 0
          AND ${table.systemInputVatAmount} = 0
          AND ${table.carriedVatCreditAmount} = 0
          AND ${table.manualAdjustmentAmount} = 0
          AND ${table.closingVatCreditAmount} = 0
          AND ${table.payableAmount} > 0
        )`,
    ),
    check(
      "chk_tax_obligation_state",
      sql`(
          BINARY ${table.status} = BINARY 'planned'
          AND ${table.paidOn} IS NULL
          AND ${table.voidReason} IS NULL
          AND ${table.voidedAtUtc} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'paid'
          AND ${table.paidOn} IS NOT NULL
          AND ${table.voidReason} IS NULL
          AND ${table.voidedAtUtc} IS NULL
        ) OR (
          BINARY ${table.status} = BINARY 'voided'
          AND ${table.paidOn} IS NULL
          AND ${table.voidReason} IS NOT NULL
          AND CHAR_LENGTH(TRIM(${table.voidReason})) BETWEEN 3 AND 2000
          AND ${table.voidedAtUtc} IS NOT NULL
        )`,
    ),
    check("chk_tax_obligation_version", sql`${table.version} >= 1`),
    check(
      "chk_tax_obligation_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}
        AND (${table.voidedAtUtc} IS NULL OR (
          ${table.createdAtUtc} <= ${table.voidedAtUtc}
          AND ${table.voidedAtUtc} <= ${table.updatedAtUtc}
        ))`,
    ),
    uniqueIndex("uq_tax_obligation_client_operation").on(
      table.clientOperationKey,
    ),
    index("idx_tax_obligation_status_due").on(
      table.status,
      table.dueOn,
      table.id,
    ),
    uniqueIndex("uq_tax_obligation_type_period").on(
      table.taxType,
      table.periodMonth,
    ),
  ],
);

export type TaxObligationRecord = typeof taxObligation.$inferSelect;
export type NewTaxObligationRecord = typeof taxObligation.$inferInsert;
