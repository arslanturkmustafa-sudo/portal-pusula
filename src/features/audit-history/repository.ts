import "server-only";

import type { Pool, RowDataPacket } from "mysql2/promise";

export type AuditHistoryRow = Readonly<{
  action: string;
  actorDisplayName: string | null;
  actorType: "system" | "user";
  afterSummary: unknown;
  beforeSummary: unknown;
  id: string;
  occurredAtUtc: string;
}>;

type StoredAuditHistoryRow = RowDataPacket & {
  action: string;
  actor_display_name: string | null;
  actor_type: string;
  after_summary: string | unknown | null;
  before_summary: string | unknown | null;
  id: string;
  occurred_at_utc: string | Date;
};

function parsedSummary(value: string | unknown | null): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function utcValue(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function listAuditHistoryRows(
  pool: Pool,
  entityType: string,
  entityId: string,
): Promise<readonly AuditHistoryRow[]> {
  const [rows] = await pool.execute<StoredAuditHistoryRow[]>(
    `SELECT ae.id, ae.action, ae.actor_type,
            ua.display_name AS actor_display_name,
            ae.before_summary, ae.after_summary,
            DATE_FORMAT(ae.occurred_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS occurred_at_utc
       FROM audit_event AS ae
       LEFT JOIN user_account AS ua ON ua.id = ae.actor_id
      WHERE BINARY ae.entity_type = BINARY ?
        AND BINARY ae.entity_id = BINARY ?
      ORDER BY ae.occurred_at_utc DESC, ae.id DESC
      LIMIT 100`,
    [entityType, entityId],
  );

  return rows.map((row) => ({
    action: row.action,
    actorDisplayName:
      typeof row.actor_display_name === "string" &&
      row.actor_display_name.trim().length > 0
        ? row.actor_display_name.trim().slice(0, 191)
        : null,
    actorType: row.actor_type === "system" ? "system" : "user",
    afterSummary: parsedSummary(row.after_summary),
    beforeSummary: parsedSummary(row.before_summary),
    id: row.id,
    occurredAtUtc: utcValue(row.occurred_at_utc),
  }));
}
