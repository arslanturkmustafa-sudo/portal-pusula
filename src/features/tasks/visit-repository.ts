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

export type VisitWorkItemReference = Readonly<{
  taskId: string;
  title: string;
}>;

type TaskVisitLinkRow = RowDataPacket & {
  task_id: string;
  visit_id: string;
};

type VisitWorkItemReferenceRow = RowDataPacket & {
  task_id: string;
  title: string;
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

export async function listVisitWorkItemReferences(
  connection: PoolConnection,
  visitId: string,
): Promise<readonly VisitWorkItemReference[]> {
  const [rows] = await connection.execute<VisitWorkItemReferenceRow[]>(
    `SELECT task.id AS task_id, task.title
       FROM work_task_visit AS task_visit
       INNER JOIN work_task AS task ON task.id = task_visit.task_id
      WHERE task_visit.visit_id = ?
      ORDER BY task.id ASC`,
    [visitId],
  );
  return rows.map((row) => {
    if (typeof row.task_id !== "string" || typeof row.title !== "string") {
      throw new Error("Visit work item projection failed.");
    }
    return { taskId: row.task_id, title: row.title };
  });
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
