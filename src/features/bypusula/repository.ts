import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Candidate, InboxItem, Mapping } from "./contract";

export type AnalysisRow = RowDataPacket & {
  id: string; source_key: string; payload_digest: string; payload_json: string;
  customer_id: string | null; project_id: string | null;
  sync_requested_at_utc: string | null; sync_last_received_at_utc: string | null;
  sync_approved_at_utc: string | null; sync_approved_by_user_account_id: string | null;
};
const analysisColumns = "id, source_key, payload_digest, payload_json, customer_id, project_id, sync_requested_at_utc, sync_last_received_at_utc, sync_approved_at_utc, sync_approved_by_user_account_id";

export async function findAnalysis(connection: PoolConnection, id: string): Promise<AnalysisRow | null> {
  const [rows] = await connection.execute<AnalysisRow[]>(
    `SELECT ${analysisColumns} FROM bypusula_analysis WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] ?? null;
}

export async function receiveAnalysis(connection: PoolConnection, input: {
  id: string; sourceKey: string; digest: string; json: string; companyName: string; analysisId: string; now: string;
}): Promise<AnalysisRow> {
  // The unique source key also serializes concurrent first deliveries.
  // Replays never replace the original immutable review snapshot.
  await connection.execute(
    `INSERT INTO bypusula_analysis (id, source_key, payload_digest, payload_json, company_name, analysis_id, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE source_key = source_key`,
    [input.id, input.sourceKey, input.digest, input.json, input.companyName, input.analysisId, input.now]);
  const [rows] = await connection.execute<AnalysisRow[]>(
    `SELECT ${analysisColumns} FROM bypusula_analysis WHERE source_key = ? FOR UPDATE`, [input.sourceKey]);
  if (!rows[0]) throw new Error("Intake unavailable.");
  return rows[0];
}

export async function listInbox(connection: PoolConnection): Promise<InboxItem[]> {
  const [rows] = await connection.execute<(RowDataPacket & InboxItem)[]>(
    `SELECT id, company_name AS companyName, analysis_id AS analysisId,
            (customer_id IS NOT NULL) AS mapped, (sync_requested_at_utc IS NOT NULL) AS automatic,
            (sync_approved_at_utc IS NOT NULL) AS approved FROM bypusula_analysis
      ORDER BY (sync_requested_at_utc IS NOT NULL AND sync_approved_at_utc IS NULL) DESC, created_at_utc DESC, id DESC LIMIT 100`);
  return rows.map((row) => ({ ...row, mapped: Boolean(row.mapped), automatic: Boolean(row.automatic), approved: Boolean(row.approved) }));
}

export async function listCandidates(connection: PoolConnection): Promise<Candidate[]> {
  const [rows] = await connection.execute<(RowDataPacket & Candidate)[]>(
    `SELECT c.id AS customerId, p.id AS projectId,
            c.display_name AS customerName, c.short_code AS customerCode,
            p.display_name AS projectName, p.short_code AS projectCode
       FROM customer_project cp JOIN customer c ON c.id = cp.customer_id JOIN project p ON p.id = cp.project_id
      WHERE cp.status = 'active' AND c.status = 'active' AND c.archived_at_utc IS NULL
        AND p.archived_at_utc IS NULL AND p.status = 'active'
      ORDER BY c.display_name, p.display_name LIMIT 1000`);
  return rows;
}

export async function validMapping(connection: PoolConnection, mapping: Mapping): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT cp.customer_id FROM customer c JOIN customer_project cp ON cp.customer_id = c.id
       JOIN project p ON p.id = cp.project_id
      WHERE c.id = ? AND p.id = ? AND c.status = 'active' AND c.archived_at_utc IS NULL
        AND cp.status = 'active' AND p.archived_at_utc IS NULL AND p.status = 'active' FOR UPDATE`,
    [mapping.customerId, mapping.projectId]);
  return rows.length === 1;
}

export async function saveMapping(connection: PoolConnection, id: string, mapping: Mapping): Promise<void> {
  await connection.execute("UPDATE bypusula_analysis SET customer_id = ?, project_id = ? WHERE id = ?", [mapping.customerId, mapping.projectId, id]);
}

export async function markAutomaticDelivery(connection: PoolConnection, id: string, now: string): Promise<void> {
  await connection.execute(`UPDATE bypusula_analysis SET sync_requested_at_utc = COALESCE(sync_requested_at_utc, ?), sync_last_received_at_utc = ? WHERE id = ?`, [now, now, id]);
}

export async function approveAutomaticMapping(connection: PoolConnection, id: string, actorId: string, now: string): Promise<void> {
  await connection.execute(`UPDATE bypusula_analysis SET sync_approved_at_utc = ?, sync_approved_by_user_account_id = ? WHERE id = ?`, [now, actorId, id]);
}

export async function listLinks(connection: PoolConnection, analysisId: string): Promise<{ key: string; taskId: string }[]> {
  const [rows] = await connection.execute<(RowDataPacket & { key: string; taskId: string })[]>(
    "SELECT step_key AS `key`, task_id AS taskId FROM bypusula_task_link WHERE analysis_id = ?", [analysisId]);
  return rows;
}

export async function findLink(connection: PoolConnection, sourceKey: string): Promise<string | null> {
  const [rows] = await connection.execute<(RowDataPacket & { task_id: string })[]>(
    "SELECT task_id FROM bypusula_task_link WHERE source_key = ? FOR UPDATE", [sourceKey]);
  return rows[0]?.task_id ?? null;
}

export async function insertLink(connection: PoolConnection, input: {
  sourceKey: string; analysisId: string; key: string; taskId: string; now: string;
}): Promise<void> {
  await connection.execute(`INSERT INTO bypusula_task_link (source_key, analysis_id, step_key, task_id, created_at_utc) VALUES (?, ?, ?, ?, ?)`,
    [input.sourceKey, input.analysisId, input.key, input.taskId, input.now]);
}
