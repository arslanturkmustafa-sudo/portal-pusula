import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type ContractStatus = "draft" | "active" | "closed";
export type VatMode = "exempt" | "exclusive" | "inclusive";
export type VisitResolutionStatus =
  | "planned"
  | "completed"
  | "makeup_pending"
  | "cancelled_by_agreement";

export type ConsultingContract = Readonly<{
  createdAtUtc: string;
  currency: "TRY";
  customerId: string;
  endsOn: string;
  id: string;
  internalNote: string | null;
  monthlyFeeAmount: string;
  paymentDay: number;
  startsOn: string;
  status: ContractStatus;
  updatedAtUtc: string;
  vatMode: VatMode;
  vatRate: string;
}>;

export type MonthlyVisit = Readonly<{
  committedOn: string;
  contractId: string;
  createdAtUtc: string;
  deliveredOn: string | null;
  id: string;
  internalDurationMinutes: number | null;
  internalPlannedAtUtc: string | null;
  resolutionNote: string | null;
  resolutionStatus: VisitResolutionStatus;
  updatedAtUtc: string;
}>;

type ContractRow = RowDataPacket & {
  created_at_utc: string | Date;
  currency: string;
  customer_id: string;
  ends_on: string | Date;
  id: string;
  internal_note: string | null;
  monthly_fee_amount: string;
  payment_day: number;
  starts_on: string | Date;
  status: string;
  updated_at_utc: string | Date;
  vat_mode: string;
  vat_rate: string;
};

type VisitRow = RowDataPacket & {
  committed_on: string | Date;
  contract_id: string;
  created_at_utc: string | Date;
  delivered_on: string | Date | null;
  id: string;
  internal_duration_minutes: number | null;
  internal_planned_at_utc: string | Date | null;
  resolution_note: string | null;
  resolution_status: string;
  updated_at_utc: string | Date;
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

function mapContract(row: ContractRow): ConsultingContract {
  if (
    row.status !== "draft" &&
    row.status !== "active" &&
    row.status !== "closed"
  ) {
    throw new Error("Contract status is invalid.");
  }
  if (
    row.vat_mode !== "exempt" &&
    row.vat_mode !== "exclusive" &&
    row.vat_mode !== "inclusive"
  ) {
    throw new Error("Contract VAT mode is invalid.");
  }
  if (row.currency !== "TRY") throw new Error("Contract currency is invalid.");

  return {
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    currency: "TRY",
    customerId: row.customer_id,
    endsOn: canonicalDate(row.ends_on),
    id: row.id,
    internalNote: row.internal_note,
    monthlyFeeAmount: row.monthly_fee_amount,
    paymentDay: row.payment_day,
    startsOn: canonicalDate(row.starts_on),
    status: row.status,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    vatMode: row.vat_mode,
    vatRate: row.vat_rate,
  };
}

function mapVisit(row: VisitRow): MonthlyVisit {
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
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    deliveredOn:
      row.delivered_on === null ? null : canonicalDate(row.delivered_on),
    id: row.id,
    internalDurationMinutes: row.internal_duration_minutes,
    internalPlannedAtUtc:
      row.internal_planned_at_utc === null
        ? null
        : canonicalDateTime(row.internal_planned_at_utc),
    resolutionNote: row.resolution_note,
    resolutionStatus: row.resolution_status,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
  };
}

const CONTRACT_COLUMNS = `
  id, customer_id, status, starts_on, ends_on, monthly_fee_amount,
  currency, vat_mode, vat_rate, payment_day, internal_note,
  created_at_utc, updated_at_utc`;

const VISIT_COLUMNS = `
  id, contract_id, committed_on, resolution_status,
  internal_planned_at_utc, internal_duration_minutes, delivered_on,
  resolution_note, created_at_utc, updated_at_utc`;

export async function listContractRecords(
  connection: PoolConnection,
  customerId: string,
): Promise<readonly ConsultingContract[]> {
  const [rows] = await connection.execute<ContractRow[]>(
    `SELECT ${CONTRACT_COLUMNS}
       FROM consulting_contract
      WHERE customer_id = ?
      ORDER BY status = 'active' DESC, starts_on DESC, id ASC`,
    [customerId],
  );
  return rows.map(mapContract);
}

export async function findOwnedContractForUpdate(
  connection: PoolConnection,
  customerId: string,
  contractId: string,
): Promise<ConsultingContract | null> {
  const [rows] = await connection.execute<ContractRow[]>(
    `SELECT ${CONTRACT_COLUMNS}
       FROM consulting_contract
      WHERE id = ? AND customer_id = ?
      FOR UPDATE`,
    [contractId, customerId],
  );
  return rows[0] ? mapContract(rows[0]) : null;
}

export async function findOverlappingContract(
  connection: PoolConnection,
  customerId: string,
  startsOn: string,
  endsOn: string,
): Promise<ConsultingContract | null> {
  const [rows] = await connection.execute<ContractRow[]>(
    `SELECT ${CONTRACT_COLUMNS}
       FROM consulting_contract
      WHERE customer_id = ?
        AND status IN ('draft', 'active')
        AND starts_on <= ?
        AND ends_on >= ?
      ORDER BY starts_on ASC, id ASC
      LIMIT 1
      FOR UPDATE`,
    [customerId, endsOn, startsOn],
  );
  return rows[0] ? mapContract(rows[0]) : null;
}

export async function insertContractRecord(
  connection: PoolConnection,
  contract: ConsultingContract,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO consulting_contract
       (id, customer_id, status, starts_on, ends_on, monthly_fee_amount,
        currency, vat_mode, vat_rate, payment_day, internal_note,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      contract.id,
      contract.customerId,
      contract.status,
      contract.startsOn,
      contract.endsOn,
      contract.monthlyFeeAmount,
      contract.currency,
      contract.vatMode,
      contract.vatRate,
      contract.paymentDay,
      contract.internalNote,
      contract.createdAtUtc,
      contract.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Contract insert failed.");
}

export async function listMonthVisitRecords(
  connection: PoolConnection,
  contractId: string,
  monthStart: string,
  nextMonthStart: string,
  lock = false,
): Promise<readonly MonthlyVisit[]> {
  const [rows] = await connection.execute<VisitRow[]>(
    `SELECT ${VISIT_COLUMNS}
       FROM monthly_visit_commitment
      WHERE contract_id = ?
        AND committed_on >= ?
        AND committed_on < ?
      ORDER BY committed_on ASC, id ASC${lock ? "\n      FOR UPDATE" : ""}`,
    [contractId, monthStart, nextMonthStart],
  );
  return rows.map(mapVisit);
}

export async function deletePlannedMonthVisits(
  connection: PoolConnection,
  contractId: string,
  monthStart: string,
  nextMonthStart: string,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `DELETE FROM monthly_visit_commitment
      WHERE contract_id = ?
        AND committed_on >= ?
        AND committed_on < ?
        AND resolution_status = 'planned'`,
    [contractId, monthStart, nextMonthStart],
  );
}

export async function insertVisitRecords(
  connection: PoolConnection,
  visits: readonly MonthlyVisit[],
): Promise<void> {
  for (const visit of visits) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO monthly_visit_commitment
         (id, contract_id, committed_on, resolution_status,
          internal_planned_at_utc, internal_duration_minutes, delivered_on,
          resolution_note, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        visit.id,
        visit.contractId,
        visit.committedOn,
        visit.resolutionStatus,
        visit.internalPlannedAtUtc,
        visit.internalDurationMinutes,
        visit.deliveredOn,
        visit.resolutionNote,
        visit.createdAtUtc,
        visit.updatedAtUtc,
      ],
    );
    if (result.affectedRows !== 1) throw new Error("Visit insert failed.");
  }
}

export async function findOwnedVisitForUpdate(
  connection: PoolConnection,
  contractId: string,
  visitId: string,
): Promise<MonthlyVisit | null> {
  const [rows] = await connection.execute<VisitRow[]>(
    `SELECT ${VISIT_COLUMNS}
       FROM monthly_visit_commitment
      WHERE id = ? AND contract_id = ?
      FOR UPDATE`,
    [visitId, contractId],
  );
  return rows[0] ? mapVisit(rows[0]) : null;
}

export async function updateVisitRecord(
  connection: PoolConnection,
  visit: MonthlyVisit,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE monthly_visit_commitment
        SET resolution_status = ?, delivered_on = ?, resolution_note = ?,
            updated_at_utc = ?
      WHERE id = ? AND contract_id = ?`,
    [
      visit.resolutionStatus,
      visit.deliveredOn,
      visit.resolutionNote,
      visit.updatedAtUtc,
      visit.id,
      visit.contractId,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Visit update failed.");
}
