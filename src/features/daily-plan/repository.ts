import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export type DailyAgendaResolutionStatus =
  | "planned"
  | "completed"
  | "makeup_pending"
  | "cancelled_by_agreement";

export type DailyAgendaItem = Readonly<{
  committedOn: string;
  contractId: string;
  customerCode: string;
  customerId: string;
  customerName: string;
  internalDurationMinutes: number | null;
  internalPlannedAtUtc: string | null;
  resolutionStatus: DailyAgendaResolutionStatus;
  visitId: string;
}>;

type DailyAgendaRow = RowDataPacket & {
  committed_on: string | Date;
  contract_id: string;
  customer_code: string;
  customer_id: string;
  customer_name: string;
  internal_duration_minutes: number | null;
  internal_planned_at_utc: string | Date | null;
  resolution_status: string;
  visit_id: string;
};

function canonicalDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function mapDailyAgendaItem(row: DailyAgendaRow): DailyAgendaItem {
  if (
    row.resolution_status !== "planned" &&
    row.resolution_status !== "completed" &&
    row.resolution_status !== "makeup_pending" &&
    row.resolution_status !== "cancelled_by_agreement"
  ) {
    throw new Error("Visit resolution status is invalid.");
  }

  return {
    committedOn: canonicalDate(row.committed_on),
    contractId: row.contract_id,
    customerCode: row.customer_code,
    customerId: row.customer_id,
    customerName: row.customer_name,
    internalDurationMinutes: row.internal_duration_minutes,
    internalPlannedAtUtc:
      row.internal_planned_at_utc === null
        ? null
        : canonicalDateTime(row.internal_planned_at_utc),
    resolutionStatus: row.resolution_status,
    visitId: row.visit_id,
  };
}

export async function listDailyAgendaItems(
  connection: PoolConnection,
  date: string,
): Promise<readonly DailyAgendaItem[]> {
  const [rows] = await connection.execute<DailyAgendaRow[]>(
    `SELECT visit.id AS visit_id,
            customer.id AS customer_id,
            customer.display_name AS customer_name,
            customer.short_code AS customer_code,
            contract.id AS contract_id,
            visit.committed_on,
            visit.internal_planned_at_utc,
            visit.internal_duration_minutes,
            visit.resolution_status
       FROM monthly_visit_commitment AS visit
       INNER JOIN consulting_contract AS contract
               ON contract.id = visit.contract_id
       INNER JOIN customer
               ON customer.id = contract.customer_id
      WHERE visit.committed_on = ?
      ORDER BY visit.internal_planned_at_utc IS NULL ASC,
               visit.internal_planned_at_utc ASC,
               visit.id ASC`,
    [date],
  );
  return rows.map(mapDailyAgendaItem);
}
