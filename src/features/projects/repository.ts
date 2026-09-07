import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  mapArchiveMetadata,
  type ArchiveMetadata,
} from "@/features/lifecycle";

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

export type Project = ArchiveMetadata & Readonly<{
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
  archive_reason: string | null;
  archived_at_utc: string | Date | null;
  archived_by_user_account_id: string | null;
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

type ProjectLifecycleDependencyRow = RowDataPacket & {
  has_dependencies: number | string;
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
  return {
    ...mapArchiveMetadata(row),
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
  };
}

const PROJECT_COLUMNS = `
  id, display_name, short_code, project_type, status, objective, starts_on,
  target_ends_on, budget_amount, currency, internal_note, closed_at_utc,
  archive_reason, archived_at_utc, archived_by_user_account_id,
  version, created_at_utc, updated_at_utc`;

export async function listProjectRecords(
  connection: PoolConnection,
): Promise<readonly Project[]> {
  const [rows] = await connection.execute<ProjectRow[]>(
    `SELECT ${PROJECT_COLUMNS}
       FROM project
      ORDER BY archived_at_utc IS NULL DESC,
               FIELD(status, 'active', 'planned', 'on_hold', 'completed', 'cancelled'),
               display_name ASC, id ASC`,
  );
  return rows.map(mapProject);
}

export async function projectHasLifecycleDependencies(
  connection: PoolConnection,
  projectId: string,
): Promise<boolean> {
  const [rows] = await connection.execute<ProjectLifecycleDependencyRow[]>(
    `SELECT (
       EXISTS(
         SELECT 1
           FROM work_task task
           JOIN work_task_project task_project ON task_project.task_id = task.id
          WHERE task_project.project_id = ?
            AND task.status NOT IN ('done', 'cancelled')
       ) OR EXISTS(
         SELECT 1
           FROM consulting_contract
          WHERE project_id = ?
            AND status IN ('draft', 'active')
       ) OR EXISTS(
         SELECT 1
           FROM receivable r
           LEFT JOIN (
             SELECT receivable_id,
                    SUM(CASE
                          WHEN entry_type = 'reversal' THEN -amount
                          ELSE amount
                        END) AS collected_amount
               FROM receivable_collection
              GROUP BY receivable_id
           ) rc ON rc.receivable_id = r.id
          WHERE r.project_id = ?
            AND r.record_state = 'active'
            AND r.total_amount > COALESCE(rc.collected_amount, 0.0000)
       )
     ) AS has_dependencies`,
    [projectId, projectId, projectId],
  );
  const value = Number(rows[0]?.has_dependencies ?? -1);
  if (value !== 0 && value !== 1) {
    throw new Error("Project lifecycle dependency query is invalid.");
  }
  return value === 1;
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
        closed_at_utc, archive_reason, archived_at_utc,
        archived_by_user_account_id, version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      project.archiveReason,
      project.archivedAtUtc,
      project.archivedByUserAccountId,
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
            currency = ?, internal_note = ?, closed_at_utc = ?,
            archive_reason = ?, archived_at_utc = ?,
            archived_by_user_account_id = ?, version = ?, updated_at_utc = ?
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
      project.archiveReason,
      project.archivedAtUtc,
      project.archivedByUserAccountId,
      project.version,
      project.updatedAtUtc,
      project.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
