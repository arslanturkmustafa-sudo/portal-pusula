import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type TaskVisitLink = Readonly<{
  taskId: string;
  visitId: string;
}>;

type TaskVisitLinkRow = RowDataPacket & {
  task_id: string;
  visit_id: string;
};

export async function findTaskVisitLinkForUpdate(
  connection: PoolConnection,
  taskId: string,
): Promise<TaskVisitLink | null> {
  const [rows] = await connection.execute<TaskVisitLinkRow[]>(
    `SELECT task_id, visit_id
       FROM work_task_visit
      WHERE task_id = ?
      FOR UPDATE`,
    [taskId],
  );
  const row = rows[0];
  if (!row) return null;
  if (
    rows.length !== 1 ||
    row.task_id !== taskId ||
    typeof row.visit_id !== "string"
  ) {
    throw new Error("Task visit link projection failed.");
  }
  return { taskId: row.task_id, visitId: row.visit_id };
}

export async function insertTaskVisitRecord(
  connection: PoolConnection,
  taskId: string,
  visitId: string,
  now: string,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO work_task_visit
       (task_id, visit_id, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?)`,
    [taskId, visitId, now, now],
  );
  if (result.affectedRows !== 1) {
    throw new Error("Task visit link insert failed.");
  }
}
