import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  primaryKey,
  varchar,
} from "drizzle-orm/mysql-core";

import { customer } from "./customer";
import { project } from "./project";

export const customerProject = mysqlTable(
  "customer_project",
  {
    customerId: char("customer_id", { length: 36 }).notNull(),
    projectId: char("project_id", { length: 36 }).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
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
    primaryKey({
      name: "pk_customer_project",
      columns: [table.customerId, table.projectId],
    }),
    check(
      "chk_customer_project_identity",
      sql`OCTET_LENGTH(${table.customerId}) = 36
        AND BINARY ${table.customerId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.projectId}) = 36
        AND BINARY ${table.projectId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "chk_customer_project_status",
      sql`BINARY ${table.status} IN (BINARY 'active', BINARY 'inactive')`,
    ),
    check("chk_customer_project_version", sql`${table.version} >= 1`),
    check(
      "chk_customer_project_timeline",
      sql`${table.createdAtUtc} <= ${table.updatedAtUtc}`,
    ),
    foreignKey({
      name: "fk_customer_project_customer",
      columns: [table.customerId],
      foreignColumns: [customer.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "fk_customer_project_project",
      columns: [table.projectId],
      foreignColumns: [project.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("idx_customer_project_project_status_customer").on(
      table.projectId,
      table.status,
      table.customerId,
    ),
  ],
);

export type CustomerProjectRecord = typeof customerProject.$inferSelect;
export type NewCustomerProjectRecord = typeof customerProject.$inferInsert;
