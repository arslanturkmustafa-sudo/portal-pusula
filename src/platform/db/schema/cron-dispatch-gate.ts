import { sql } from "drizzle-orm";
import {
  check,
  datetime,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Durable, cross-process cron frequency fence. A row is created on the first
 * permit and thereafter records only the most recent permitted instant.
 */
export const cronDispatchGate = mysqlTable(
  "cron_dispatch_gate",
  {
    gateKey: varchar("gate_key", { length: 128 }).primaryKey(),
    state: varchar("state", { length: 16 }).default("active").notNull(),
    lastPermittedAtUtc: datetime("last_permitted_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
    createdAtUtc: datetime("created_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
    updatedAtUtc: datetime("updated_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    check(
      "chk_cron_dispatch_gate_key_format",
      sql`BINARY ${table.gateKey} REGEXP '^[!-~]+$'`,
    ),
    check(
      "chk_cron_dispatch_gate_state",
      sql`BINARY ${table.state} = BINARY 'active'`,
    ),
    check(
      "chk_cron_dispatch_gate_timeline",
      sql`${table.createdAtUtc} <= ${table.lastPermittedAtUtc}
        AND ${table.lastPermittedAtUtc} = ${table.updatedAtUtc}`,
    ),
  ],
);

export type CronDispatchGateRecord = typeof cronDispatchGate.$inferSelect;
export type NewCronDispatchGateRecord = typeof cronDispatchGate.$inferInsert;
