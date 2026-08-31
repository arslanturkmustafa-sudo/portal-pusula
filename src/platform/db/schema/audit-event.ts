import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  index,
  json,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

/** Append-only application audit records; no update/delete repository exists. */
export const auditEvent = mysqlTable(
  "audit_event",
  {
    id: char("id", { length: 36 }).primaryKey(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorId: char("actor_id", { length: 36 }),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entity_type", { length: 128 }).notNull(),
    entityId: char("entity_id", { length: 36 }).notNull(),
    beforeSummary: json("before_summary"),
    afterSummary: json("after_summary"),
    correlationId: varchar("correlation_id", { length: 64 }).notNull(),
    occurredAtUtc: datetime("occurred_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    check(
      "chk_audit_event_actor_type",
      sql`${table.actorType} IN ('system', 'user')`,
    ),
    check(
      "chk_audit_event_identity_format",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (
          ${table.actorId} IS NULL
          OR (
            OCTET_LENGTH(${table.actorId}) = 36
            AND BINARY ${table.actorId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        AND BINARY ${table.action} REGEXP '^[!-~]+$'
        AND BINARY ${table.entityType} REGEXP '^[!-~]+$'
        AND OCTET_LENGTH(${table.entityId}) = 36
        AND BINARY ${table.entityId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY ${table.correlationId} REGEXP '^[!-~]+$'`,
    ),
    index("idx_audit_event_entity_occurred").on(
      table.entityType,
      table.entityId,
      table.occurredAtUtc,
    ),
    index("idx_audit_event_correlation_occurred").on(
      table.correlationId,
      table.occurredAtUtc,
    ),
  ],
);

export type AuditEventRecord = typeof auditEvent.$inferSelect;
export type NewAuditEventRecord = typeof auditEvent.$inferInsert;
