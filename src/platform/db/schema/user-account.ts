import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const userAccount = mysqlTable(
  "user_account",
  {
    id: char("id", { length: 36 }).primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: varchar("password_hash", { length: 191 }).notNull(),
    credentialVersion: int("credential_version", { unsigned: true })
      .default(1)
      .notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    passwordChangedAtUtc: datetime("password_changed_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
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
      "chk_user_account_id_format",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_user_account_email",
      sql`CHAR_LENGTH(${table.email}) BETWEEN 3 AND 254
        AND ${table.email} = TRIM(${table.email})
        AND BINARY ${table.email} = BINARY LOWER(${table.email})`,
    ),
    check(
      "chk_user_account_password_hash",
      sql`BINARY ${table.passwordHash} REGEXP '^(scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}|scrypt\\$32768\\$8\\$1\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{86})$'`,
    ),
    check(
      "chk_user_account_state",
      sql`${table.credentialVersion} >= 1
        AND BINARY ${table.status} IN (BINARY 'active', BINARY 'disabled')`,
    ),
    check(
      "chk_user_account_timeline",
      sql`${table.createdAtUtc} <= ${table.passwordChangedAtUtc}
        AND ${table.passwordChangedAtUtc} <= ${table.updatedAtUtc}`,
    ),
    uniqueIndex("uq_user_account_email").on(table.email),
  ],
);

export type UserAccountRecord = typeof userAccount.$inferSelect;
export type NewUserAccountRecord = typeof userAccount.$inferInsert;
