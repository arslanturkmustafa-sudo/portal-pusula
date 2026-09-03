import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type ProjectType =
  | "consulting"
  | "product"
  | "partnership"
  | "internal";
export type ProjectStatus =
  | "planned"
  | "active"
  | "on_hold"
  | "completed"
  | "cancelled";

export type Project = Readonly<{
  budgetAmount: string | null;
  closedAtUtc: string | null;
  createdAtUtc: string;
  currency: "TRY";
  displayName: string;
  id: string;
  internalNote: string | null;
  objective: string | null;
  projectType: ProjectType;
  shortCode: string;
  startsOn: string | null;
  status: ProjectStatus;
  targetEndsOn: string | null;
  updatedAtUtc: string;
  version: number;
}>;

type ProjectRow = RowDataPacket & {
  budget_amount: string | null;
  closed_at_utc: string | Date | null;
  created_at_utc: string | Date;
  currency: string;
  display_name: string;
  id: string;
  internal_note: string | null;
  objective: string | null;
  project_type: string;
  short_code: string;
  starts_on: string | Date | null;
  status: string;
  target_ends_on: string | Date | null;
  updated_at_utc: string | Date;
  version: number;
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

function projectType(value: string): ProjectType {
  if (
    value !== "consulting" &&
    value !== "product" &&
    value !== "partnership" &&
    value !== "internal"
  ) {
    throw new Error("Project type is invalid.");
  }
  return value;
}

function projectStatus(value: string): ProjectStatus {
  if (
    value !== "planned" &&
    value !== "active" &&
    value !== "on_hold" &&
    value !== "completed" &&
    value !== "cancelled"
  ) {
    throw new Error("Project status is invalid.");
  }
  return value;
}

function mapProject(row: ProjectRow): Project {
  if (row.currency !== "TRY") throw new Error("Project currency is invalid.");
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new Error("Project version is invalid.");
  }
  return {
    budgetAmount: row.budget_amount,
    closedAtUtc:
      row.closed_at_utc === null ? null : canonicalDateTime(row.closed_at_utc),
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    currency: "TRY",
    displayName: row.display_name,
    id: row.id,
    internalNote: row.internal_note,
    objective: row.objective,
    projectType: projectType(row.project_type),
    shortCode: row.short_code,
    startsOn: row.starts_on === null ? null : canonicalDate(row.starts_on),
    status: projectStatus(row.status),
    targetEndsOn:
      row.target_ends_on === null ? null : canonicalDate(row.target_ends_on),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: row.version,
  };
}

const PROJECT_COLUMNS = `
  id, display_name, short_code, project_type, status, objective, starts_on,
  target_ends_on, budget_amount, currency, internal_note, closed_at_utc,
  version, created_at_utc, updated_at_utc`;

export async function listProjectRecords(
  connection: PoolConnection,
): Promise<readonly Project[]> {
  const [rows] = await connection.execute<ProjectRow[]>(
    `SELECT ${PROJECT_COLUMNS}
       FROM project
      ORDER BY FIELD(status, 'active', 'planned', 'on_hold', 'completed', 'cancelled'),
               display_name ASC, id ASC`,
  );
  return rows.map(mapProject);
}

export async function findProjectForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<Project | null> {
  const [rows] = await connection.execute<ProjectRow[]>(
    `SELECT ${PROJECT_COLUMNS}
       FROM project
      WHERE id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapProject(rows[0]) : null;
}

export async function insertProjectRecord(
  connection: PoolConnection,
  project: Project,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO project
       (id, display_name, short_code, project_type, status, objective,
        starts_on, target_ends_on, budget_amount, currency, internal_note,
        closed_at_utc, version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.displayName,
      project.shortCode,
      project.projectType,
      project.status,
      project.objective,
      project.startsOn,
      project.targetEndsOn,
      project.budgetAmount,
      project.currency,
      project.internalNote,
      project.closedAtUtc,
      project.version,
      project.createdAtUtc,
      project.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Project insert failed.");
}

export async function updateProjectRecord(
  connection: PoolConnection,
  project: Project,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE project
        SET display_name = ?, short_code = ?, project_type = ?, status = ?,
            objective = ?, starts_on = ?, target_ends_on = ?, budget_amount = ?,
            currency = ?, internal_note = ?, closed_at_utc = ?, version = ?,
            updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      project.displayName,
      project.shortCode,
      project.projectType,
      project.status,
      project.objective,
      project.startsOn,
      project.targetEndsOn,
      project.budgetAmount,
      project.currency,
      project.internalNote,
      project.closedAtUtc,
      project.version,
      project.updatedAtUtc,
      project.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
