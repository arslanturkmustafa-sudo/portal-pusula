import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  primaryKey,
} from "drizzle-orm/mysql-core";

import { monthlyVisitCommitment } from "./consulting-contract";
import { workTask } from "./work-task";

export const workTaskVisit = mysqlTable(
  "work_task_visit",
  {
    taskId: char("task_id", { length: 36 }).notNull(),
    visitId: char("visit_id", { length: 36 }).notNull(),
    createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
    updatedAtUtc: datetime("updated_at_utc", { fsp: 6, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    primaryKey({ name: "pk_work_task_visit", columns: [table.taskId] }),
    check(
      "chk_work_task_visit_identity",
      sql`OCTET_LENGTH(${table.taskId}) = 36
        AND BINARY ${table.taskId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.visitId}) = 36
        AND BINARY ${table.visitId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_work_task_visit_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_work_task_visit_task",
      columns: [table.taskId],
      foreignColumns: [workTask.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_work_task_visit_visit",
      columns: [table.visitId],
      foreignColumns: [monthlyVisitCommitment.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("idx_work_task_visit_visit_task").on(table.visitId, table.taskId),
  ],
);

export type WorkTaskVisitRecord = typeof workTaskVisit.$inferSelect;
export type NewWorkTaskVisitRecord = typeof workTaskVisit.$inferInsert;
