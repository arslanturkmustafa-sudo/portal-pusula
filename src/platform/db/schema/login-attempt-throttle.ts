import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  index,
  int,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

export const loginAttemptThrottle = mysqlTable(
  "login_attempt_throttle",
  {
    bucketKey: char("bucket_key", { length: 64 }).primaryKey(),
    bucketType: varchar("bucket_type", { length: 16 }).notNull(),
    failureCount: int("failure_count", { unsigned: true }).notNull(),
    windowStartedAtUtc: datetime("window_started_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
    blockedUntilUtc: datetime("blocked_until_utc", {
      fsp: 6,
      mode: "string",
    }),
    updatedAtUtc: datetime("updated_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    check(
      "chk_login_attempt_throttle_key",
      sql`OCTET_LENGTH(${table.bucketKey}) = 64
        AND BINARY ${table.bucketKey} REGEXP '^[0-9a-f]{64}$'`,
    ),
    check(
      "chk_login_attempt_throttle_state",
      sql`BINARY ${table.bucketType} IN (BINARY 'account', BINARY 'global', BINARY 'network')
        AND ${table.failureCount} BETWEEN 1 AND 1000
        AND ${table.windowStartedAtUtc} <= ${table.updatedAtUtc}
        AND (${table.blockedUntilUtc} IS NULL OR ${table.blockedUntilUtc} >= ${table.updatedAtUtc})`,
    ),
    index("idx_login_attempt_throttle_updated").on(table.updatedAtUtc),
    index("idx_login_attempt_throttle_blocked").on(table.blockedUntilUtc),
  ],
);

export type LoginAttemptThrottleRecord =
  typeof loginAttemptThrottle.$inferSelect;
export type NewLoginAttemptThrottleRecord =
  typeof loginAttemptThrottle.$inferInsert;
