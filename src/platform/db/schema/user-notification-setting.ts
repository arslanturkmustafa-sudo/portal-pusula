import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  foreignKey,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

import { userAccount } from "./user-account";

export const userNotificationSetting = mysqlTable(
  "user_notification_setting",
  {
    userAccountId: char("user_account_id", { length: 36 }).primaryKey(),
    recipientEmail: varchar("recipient_email", { length: 254 }).notNull(),
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
      "chk_user_notification_setting_account_id",
      sql`OCTET_LENGTH(${table.userAccountId}) = 36
        AND BINARY ${table.userAccountId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_user_notification_setting_email",
      sql`CHAR_LENGTH(${table.recipientEmail}) BETWEEN 3 AND 254
        AND ${table.recipientEmail} = TRIM(${table.recipientEmail})
        AND BINARY ${table.recipientEmail} = BINARY LOWER(${table.recipientEmail})`,
    ),
    check(
      "chk_user_notification_setting_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_user_notification_setting_account",
      columns: [table.userAccountId],
      foreignColumns: [userAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);

export type UserNotificationSettingRecord =
  typeof userNotificationSetting.$inferSelect;
export type NewUserNotificationSettingRecord =
  typeof userNotificationSetting.$inferInsert;
