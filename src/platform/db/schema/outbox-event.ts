import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Durable platform events awaiting delivery through an idempotent adapter. */
export const outboxEvent = mysqlTable(
  "outbox_event",
  {
    id: char("id", { length: 36 }).primaryKey(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    schemaVersion: int("schema_version", { unsigned: true }).notNull(),
    payload: json("payload").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 191 }).notNull(),
    availableAtUtc: datetime("available_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    attemptCount: smallint("attempt_count", { unsigned: true })
      .default(0)
      .notNull(),
    maxAttempts: smallint("max_attempts", { unsigned: true }).notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseToken: char("lease_token", { length: 36 }),
    leaseExpiresAtUtc: datetime("lease_expires_at_utc", {
      fsp: 6,
      mode: "string",
    }),
    deliveredAtUtc: datetime("delivered_at_utc", {
      fsp: 6,
      mode: "string",
    }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
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
      "chk_outbox_event_attempt_bounds",
      sql`${table.maxAttempts} >= 1 AND ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    check(
      "chk_outbox_event_status",
      sql`${table.status} IN ('pending', 'retry', 'leased', 'delivered', 'dead_letter')`,
    ),
    check(
      "chk_outbox_event_lease_shape",
      sql`(
        ${table.status} = 'leased'
        AND ${table.leaseOwner} IS NOT NULL
        AND ${table.leaseToken} IS NOT NULL
        AND ${table.leaseExpiresAtUtc} IS NOT NULL
      ) OR (
        ${table.status} <> 'leased'
        AND ${table.leaseOwner} IS NULL
        AND ${table.leaseToken} IS NULL
        AND ${table.leaseExpiresAtUtc} IS NULL
      )`,
    ),
    check(
      "chk_outbox_event_identity_format",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY ${table.eventType} REGEXP '^[!-~]+$'
        AND BINARY ${table.idempotencyKey} REGEXP '^[!-~]+$'
        AND (
          ${table.leaseOwner} IS NULL
          OR BINARY ${table.leaseOwner} REGEXP '^[!-~]+$'
        )
        AND (
          ${table.leaseToken} IS NULL
          OR (
            OCTET_LENGTH(${table.leaseToken}) = 36
            AND BINARY ${table.leaseToken} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        AND (
          ${table.lastErrorCode} IS NULL
          OR BINARY ${table.lastErrorCode} REGEXP '^[!-~]+$'
        )`,
    ),
    uniqueIndex("uq_outbox_event_idempotency").on(table.idempotencyKey),
    uniqueIndex("uq_outbox_event_lease_token").on(table.leaseToken),
    index("idx_outbox_event_claim_ready").on(
      table.status,
      table.availableAtUtc,
      table.id,
    ),
    index("idx_outbox_event_claim_expired").on(
      table.status,
      table.leaseExpiresAtUtc,
      table.id,
    ),
  ],
);

export type OutboxEventRecord = typeof outboxEvent.$inferSelect;
export type NewOutboxEventRecord = typeof outboxEvent.$inferInsert;
