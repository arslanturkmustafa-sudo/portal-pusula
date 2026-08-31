import { sql } from "drizzle-orm";
import {
  bigint,
  decimal,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Disposable platform-only records used to verify the migration and MariaDB
 * correctness boundary. This is deliberately not a customer, project, or
 * finance domain table.
 */
export const platformMigrationVerification = mysqlTable(
  "_platform_migration_verification",
  {
    probeId: bigint("probe_id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    decimalRoundTripValue: decimal("decimal_round_trip_value", {
      precision: 19,
      scale: 4,
    }).notNull(),
    observedAtUtc: timestamp("observed_at_utc", {
      fsp: 6,
      mode: "string",
    })
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_platform_migration_verification_idempotency").on(
      table.idempotencyKey,
    ),
  ],
);

export type PlatformMigrationVerificationRecord =
  typeof platformMigrationVerification.$inferSelect;

export type NewPlatformMigrationVerificationRecord =
  typeof platformMigrationVerification.$inferInsert;
