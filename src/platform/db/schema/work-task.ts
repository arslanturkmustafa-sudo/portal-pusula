import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

import { customer } from "./customer";
import { userAccount } from "./user-account";

export const workTask = mysqlTable(
  "work_task",
  {
    id: char("id", { length: 36 }).primaryKey(),
    customerId: char("customer_id", { length: 36 }),
    assigneeUserAccountId: char("assignee_user_account_id", { length: 36 }),
    title: varchar("title", { length: 191 }).notNull(),
    description: varchar("description", { length: 4000 }),
    status: varchar("status", { length: 24 }).default("backlog").notNull(),
    priority: varchar("priority", { length: 16 }).default("normal").notNull(),
    dueOn: date("due_on", { mode: "string" }),
    completedAtUtc: datetime("completed_at_utc", {
      fsp: 6,
      mode: "string",
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
      "chk_work_task_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (${table.customerId} IS NULL OR (
          OCTET_LENGTH(${table.customerId}) = 36
          AND BINARY ${table.customerId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (${table.assigneeUserAccountId} IS NULL OR (
          OCTET_LENGTH(${table.assigneeUserAccountId}) = 36
          AND BINARY ${table.assigneeUserAccountId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))`,
    ),
    check(
      "chk_work_task_title",
      sql`CHAR_LENGTH(${table.title}) BETWEEN 1 AND 191
        AND ${table.title} = TRIM(${table.title})`,
    ),
    check(
      "chk_work_task_description",
      sql`${table.description} IS NULL
        OR CHAR_LENGTH(${table.description}) BETWEEN 1 AND 4000`,
    ),
    check(
      "chk_work_task_status",
      sql`BINARY ${table.status} IN (
        BINARY 'backlog', BINARY 'todo', BINARY 'in_progress',
        BINARY 'blocked', BINARY 'done'
      )`,
    ),
    check(
      "chk_work_task_priority",
      sql`BINARY ${table.priority} IN (
        BINARY 'low', BINARY 'normal', BINARY 'high', BINARY 'urgent'
      )`,
    ),
    check(
      "chk_work_task_completion",
      sql`(
        ${table.status} = 'done'
        AND ${table.completedAtUtc} IS NOT NULL
      ) OR (
        ${table.status} <> 'done'
        AND ${table.completedAtUtc} IS NULL
      )`,
    ),
    check("chk_work_task_version", sql`${table.version} >= 1`),
    check(
      "chk_work_task_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}
        AND (
          ${table.completedAtUtc} IS NULL
          OR (
            ${table.createdAtUtc} <= ${table.completedAtUtc}
            AND ${table.completedAtUtc} <= ${table.updatedAtUtc}
          )
        )`,
    ),
    foreignKey({
      name: "fk_work_task_customer",
      columns: [table.customerId],
      foreignColumns: [customer.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_work_task_assignee",
      columns: [table.assigneeUserAccountId],
      foreignColumns: [userAccount.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("idx_work_task_board").on(
      table.status,
      table.dueOn,
      table.updatedAtUtc,
    ),
    index("idx_work_task_customer_status").on(
      table.customerId,
      table.status,
      table.dueOn,
    ),
    index("idx_work_task_assignee_status").on(
      table.assigneeUserAccountId,
      table.status,
      table.dueOn,
    ),
  ],
);

export type WorkTaskRecord = typeof workTask.$inferSelect;
export type NewWorkTaskRecord = typeof workTask.$inferInsert;
