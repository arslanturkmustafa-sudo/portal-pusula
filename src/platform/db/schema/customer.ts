import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { userAccount } from "./user-account";

export const customer = mysqlTable(
  "customer",
  {
    id: char("id", { length: 36 }).primaryKey(),
    displayName: varchar("display_name", { length: 191 }).notNull(),
    shortCode: varchar("short_code", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    contactNote: varchar("contact_note", { length: 2000 }),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 32 }),
    archiveReason: varchar("archive_reason", { length: 500 }),
    archivedAtUtc: datetime("archived_at_utc", { fsp: 6, mode: "string" }),
    archivedByUserAccountId: char("archived_by_user_account_id", {
      length: 36,
    }),
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
      "chk_customer_id_format",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_customer_display_name",
      sql`CHAR_LENGTH(${table.displayName}) BETWEEN 1 AND 191
        AND ${table.displayName} = TRIM(${table.displayName})`,
    ),
    check(
      "chk_customer_short_code",
      sql`BINARY ${table.shortCode} REGEXP '^[A-Z0-9][A-Z0-9_-]{0,31}$'`,
    ),
    check(
      "chk_customer_status",
      sql`BINARY ${table.status} IN (BINARY 'active', BINARY 'inactive')`,
    ),
    check(
      "chk_customer_optional_fields",
      sql`(${table.contactNote} IS NULL OR CHAR_LENGTH(${table.contactNote}) BETWEEN 1 AND 2000)
        AND (${table.email} IS NULL OR CHAR_LENGTH(${table.email}) BETWEEN 3 AND 254)
        AND (${table.phone} IS NULL OR CHAR_LENGTH(${table.phone}) BETWEEN 3 AND 32)`,
    ),
    check(
      "chk_customer_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}
        AND (
          ${table.archivedAtUtc} IS NULL
          OR (
            ${table.createdAtUtc} <= ${table.archivedAtUtc}
            AND ${table.archivedAtUtc} <= ${table.updatedAtUtc}
          )
        )`,
    ),
    check("chk_customer_version", sql`${table.version} >= 1`),
    check(
      "chk_customer_archive",
      sql`(
          ${table.archivedAtUtc} IS NULL
          AND ${table.archivedByUserAccountId} IS NULL
          AND ${table.archiveReason} IS NULL
        ) OR (
          ${table.archivedAtUtc} IS NOT NULL
          AND ${table.archivedByUserAccountId} IS NOT NULL
          AND ${table.archiveReason} IS NOT NULL
          AND CHAR_LENGTH(${table.archiveReason}) BETWEEN 1 AND 500
          AND ${table.archiveReason} = TRIM(${table.archiveReason})
          AND BINARY ${table.status} = BINARY 'inactive'
        )`,
    ),
    foreignKey({
      name: "fk_customer_archived_by",
      columns: [table.archivedByUserAccountId],
      foreignColumns: [userAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_customer_short_code").on(table.shortCode),
    index("idx_customer_status_name").on(
      table.archivedAtUtc,
      table.status,
      table.displayName,
    ),
  ],
);

export type CustomerRecord = typeof customer.$inferSelect;
export type NewCustomerRecord = typeof customer.$inferInsert;
