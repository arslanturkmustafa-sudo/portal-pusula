import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  foreignKey,
  mysqlTable,
  primaryKey,
  varchar,
} from "drizzle-orm/mysql-core";

import { userAccount } from "./user-account";

export const userPermission = mysqlTable(
  "user_permission",
  {
    userAccountId: char("user_account_id", { length: 36 }).notNull(),
    permissionCode: varchar("permission_code", { length: 64 }).notNull(),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userAccountId, table.permissionCode] }),
    foreignKey({
      name: "fk_user_permission_account",
      columns: [table.userAccountId],
      foreignColumns: [userAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "chk_user_permission_code",
      sql`BINARY ${table.permissionCode} IN (
        BINARY 'accounts.manage',
        BINARY 'customers.read', BINARY 'customers.write', BINARY 'customers.lifecycle',
        BINARY 'customers.contact.read',
        BINARY 'contracts.read', BINARY 'contracts.write', BINARY 'contracts.lifecycle',
        BINARY 'contracts.billing.read', BINARY 'contracts.billing.write',
        BINARY 'visits.read', BINARY 'visits.write', BINARY 'daily-plan.read',
        BINARY 'projects.read', BINARY 'projects.write', BINARY 'projects.lifecycle',
        BINARY 'tasks.read', BINARY 'tasks.write', BINARY 'tasks.lifecycle', BINARY 'tasks.assign',
        BINARY 'tasks.reports.export',
        BINARY 'finance.receivables.read', BINARY 'finance.receivables.write',
        BINARY 'finance.receivables.reverse',
        BINARY 'finance.expenses.read', BINARY 'finance.expenses.write',
        BINARY 'finance.expenses.reverse',
        BINARY 'finance.cards.read', BINARY 'finance.cards.write',
        BINARY 'finance.accounts.read', BINARY 'finance.accounts.write',
        BINARY 'finance.partnership.read', BINARY 'finance.partnership.write',
        BINARY 'finance.partnership.reverse',
        BINARY 'finance.taxes.read', BINARY 'finance.taxes.write',
        BINARY 'finance.reports.read', BINARY 'finance.reports.export',
        BINARY 'audit.read'
      )`,
    ),
  ],
);

export type UserPermissionRecord = typeof userPermission.$inferSelect;
export type NewUserPermissionRecord = typeof userPermission.$inferInsert;
