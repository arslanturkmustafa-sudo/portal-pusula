import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { scheduledJob } from "./scheduled-job";

/** Immutable attempt history for platform jobs. */
export const jobRun = mysqlTable(
  "job_run",
  {
    id: char("id", { length: 36 }).primaryKey(),
    jobId: char("job_id", { length: 36 }).notNull(),
    attemptNo: smallint("attempt_no", { unsigned: true }).notNull(),
    leaseToken: char("lease_token", { length: 36 }).notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }).notNull(),
    startedAtUtc: datetime("started_at_utc", {
      fsp: 6,
      mode: "string",
    }).notNull(),
    completedAtUtc: datetime("completed_at_utc", {
      fsp: 6,
      mode: "string",
    }),
    outcome: varchar("outcome", { length: 32 }).default("running").notNull(),
    correlationId: varchar("correlation_id", { length: 64 }).notNull(),
    errorCode: varchar("error_code", { length: 64 }),
  },
  (table) => [
    check(
      "chk_job_run_outcome_state",
      sql`(
        ${table.outcome} = 'running'
        AND ${table.completedAtUtc} IS NULL
      ) OR (
        ${table.outcome} IN ('succeeded', 'retry', 'dead_letter', 'lease_expired')
        AND ${table.completedAtUtc} IS NOT NULL
      )`,
    ),
    check(
      "chk_job_run_identity_format",
      sql`OCTET_LENGTH(${table.id}) = 36
        AND BINARY ${table.id} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.jobId}) = 36
        AND BINARY ${table.jobId} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(${table.leaseToken}) = 36
        AND BINARY ${table.leaseToken} REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY ${table.leaseOwner} REGEXP '^[!-~]+$'
        AND BINARY ${table.correlationId} REGEXP '^[!-~]+$'
        AND (
          ${table.errorCode} IS NULL
          OR BINARY ${table.errorCode} REGEXP '^[!-~]+$'
        )`,
    ),
    foreignKey({
      name: "fk_job_run_scheduled_job",
      columns: [table.jobId],
      foreignColumns: [scheduledJob.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("uq_job_run_job_attempt").on(table.jobId, table.attemptNo),
    index("idx_job_run_job_started").on(table.jobId, table.startedAtUtc),
    index("idx_job_run_correlation_started").on(
      table.correlationId,
      table.startedAtUtc,
    ),
  ],
);

export type JobRunRecord = typeof jobRun.$inferSelect;
export type NewJobRunRecord = typeof jobRun.$inferInsert;
