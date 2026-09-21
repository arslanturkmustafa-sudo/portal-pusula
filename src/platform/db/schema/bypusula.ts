import { sql } from "drizzle-orm";
import { char, check, datetime, foreignKey, index, longtext, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { customerProject } from "./customer-project";
import { workTask } from "./work-task";
import { userAccount } from "./user-account";

// Additive adapter tables: existing customer, project and task models stay intact.
export const bypusulaAnalysis = mysqlTable("bypusula_analysis", {
  id: char("id", { length: 36 }).primaryKey(),
  sourceKey: char("source_key", { length: 64 }).notNull(),
  payloadDigest: char("payload_digest", { length: 64 }).notNull(),
  payloadJson: longtext("payload_json").notNull(),
  companyName: varchar("company_name", { length: 191 }).notNull(),
  analysisId: varchar("analysis_id", { length: 20 }).notNull(),
  customerId: char("customer_id", { length: 36 }),
  projectId: char("project_id", { length: 36 }),
  createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" }).notNull(),
  syncRequestedAtUtc: datetime("sync_requested_at_utc", { fsp: 6, mode: "string" }),
  syncLastReceivedAtUtc: datetime("sync_last_received_at_utc", { fsp: 6, mode: "string" }),
  syncApprovedAtUtc: datetime("sync_approved_at_utc", { fsp: 6, mode: "string" }),
  syncApprovedByUserAccountId: char("sync_approved_by_user_account_id", { length: 36 }),
}, (table) => [
  uniqueIndex("uq_bypusula_analysis_source").on(table.sourceKey),
  check("chk_bypusula_analysis_hash", sql`BINARY ${table.sourceKey} REGEXP '^[0-9a-f]{64}$' AND BINARY ${table.payloadDigest} REGEXP '^[0-9a-f]{64}$'`),
  check("chk_bypusula_analysis_json", sql`JSON_VALID(${table.payloadJson})`),
  check("chk_bypusula_analysis_mapping", sql`(${table.customerId} IS NULL AND ${table.projectId} IS NULL) OR (${table.customerId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`),
  foreignKey({ name: "fk_bypusula_analysis_mapping", columns: [table.customerId, table.projectId], foreignColumns: [customerProject.customerId, customerProject.projectId] }).onDelete("restrict").onUpdate("restrict"),
  check("chk_bypusula_sync_approval", sql`(${table.syncApprovedAtUtc} IS NULL AND ${table.syncApprovedByUserAccountId} IS NULL) OR (${table.syncApprovedAtUtc} IS NOT NULL AND ${table.syncApprovedByUserAccountId} IS NOT NULL AND ${table.syncRequestedAtUtc} IS NOT NULL AND ${table.customerId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`),
  foreignKey({ name: "fk_bypusula_sync_approver", columns: [table.syncApprovedByUserAccountId], foreignColumns: [userAccount.id] }).onDelete("restrict").onUpdate("restrict"),
]);

export const bypusulaTaskLink = mysqlTable("bypusula_task_link", {
  sourceKey: char("source_key", { length: 64 }).primaryKey(),
  analysisId: char("analysis_id", { length: 36 }).notNull(),
  stepKey: varchar("step_key", { length: 100 }).notNull(),
  taskId: char("task_id", { length: 36 }).notNull(),
  createdAtUtc: datetime("created_at_utc", { fsp: 6, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("uq_bypusula_task_link_task").on(table.taskId),
  uniqueIndex("uq_bypusula_task_link_step").on(table.analysisId, table.stepKey),
  index("idx_bypusula_task_link_analysis").on(table.analysisId),
  check("chk_bypusula_task_link_hash", sql`BINARY ${table.sourceKey} REGEXP '^[0-9a-f]{64}$'`),
  foreignKey({ name: "fk_bypusula_task_link_analysis", columns: [table.analysisId], foreignColumns: [bypusulaAnalysis.id] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "fk_bypusula_task_link_task", columns: [table.taskId], foreignColumns: [workTask.id] }).onDelete("restrict").onUpdate("restrict"),
]);
