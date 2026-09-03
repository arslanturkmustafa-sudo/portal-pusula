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
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { workTask } from "./work-task";

export const project = mysqlTable(
  "project",
  {
    id: char("id", { length: 36 }).primaryKey(),
    displayName: varchar("display_name", { length: 191 }).notNull(),
    shortCode: varchar("short_code", { length: 32 }).notNull(),
    projectType: varchar("project_type", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).default("planned").notNull(),
    objective: varchar("objective", { length: 4000 }),
    startsOn: date("starts_on", { mode: "string" }),
    targetEndsOn: date("target_ends_on", { mode: "string" }),
    budgetAmount: decimal("budget_amount", { precision: 19, scale: 4 }),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    internalNote: varchar("internal_note", { length: 2000 }),
    closedAtUtc: datetime("closed_at_utc", { fsp: 6, mode: "string" }),
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
      "chk_project_identity",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_project_display_name",
      sql`CHAR_LENGTH(${table.displayName}) BETWEEN 1 AND 191
        AND ${table.displayName} = TRIM(${table.displayName})`,
    ),
    check(
      "chk_project_short_code",
      sql`BINARY ${table.shortCode} REGEXP '^[A-Z0-9][A-Z0-9_-]{0,31}$'`,
    ),
    check(
      "chk_project_type",
      sql`BINARY ${table.projectType} IN (
        BINARY 'consulting', BINARY 'product', BINARY 'partnership',
        BINARY 'internal'
      )`,
    ),
    check(
      "chk_project_status",
      sql`BINARY ${table.status} IN (
        BINARY 'planned', BINARY 'active', BINARY 'on_hold',
        BINARY 'completed', BINARY 'cancelled'
      )`,
    ),
    check(
      "chk_project_optional_text",
      sql`(${table.objective} IS NULL OR CHAR_LENGTH(${table.objective}) BETWEEN 1 AND 4000)
        AND (${table.internalNote} IS NULL OR CHAR_LENGTH(${table.internalNote}) BETWEEN 1 AND 2000)`,
    ),
    check(
      "chk_project_period",
      sql`${table.startsOn} IS NULL
        OR ${table.targetEndsOn} IS NULL
        OR ${table.startsOn} <= ${table.targetEndsOn}`,
    ),
    check(
      "chk_project_budget",
      sql`(${table.budgetAmount} IS NULL OR ${table.budgetAmount} >= 0)
        AND BINARY ${table.currency} = BINARY 'TRY'`,
    ),
    check(
      "chk_project_closure",
      sql`(
          BINARY ${table.status} IN (BINARY 'completed', BINARY 'cancelled')
          AND ${table.closedAtUtc} IS NOT NULL
        ) OR (
          BINARY ${table.status} NOT IN (BINARY 'completed', BINARY 'cancelled')
          AND ${table.closedAtUtc} IS NULL
        )`,
    ),
    check("chk_project_version", sql`${table.version} >= 1`),
    check(
      "chk_project_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}
        AND (
          ${table.closedAtUtc} IS NULL
          OR (
            ${table.createdAtUtc} <= ${table.closedAtUtc}
            AND ${table.closedAtUtc} <= ${table.updatedAtUtc}
          )
        )`,
    ),
    uniqueIndex("uq_project_short_code").on(table.shortCode),
    index("idx_project_status_name").on(table.status, table.displayName),
    index("idx_project_type_status").on(table.projectType, table.status),
  ],
);

export const workTaskProject = mysqlTable(
  "work_task_project",
  {
    taskId: char("task_id", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }).notNull(),
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
    primaryKey({ name: "pk_work_task_project", columns: [table.taskId] }),
    check(
      "chk_work_task_project_identity",
      sql`OCTET_LENGTH(${table.taskId}) = 36
        AND BINARY ${table.taskId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.projectId}) = 36
        AND BINARY ${table.projectId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_work_task_project_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_work_task_project_task",
      columns: [table.taskId],
      foreignColumns: [workTask.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_work_task_project_project",
      columns: [table.projectId],
      foreignColumns: [project.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("idx_work_task_project_project_task").on(
      table.projectId,
      table.taskId,
    ),
  ],
);

export type ProjectRecord = typeof project.$inferSelect;
export type NewProjectRecord = typeof project.$inferInsert;
export type WorkTaskProjectRecord = typeof workTaskProject.$inferSelect;
export type NewWorkTaskProjectRecord = typeof workTaskProject.$inferInsert;
