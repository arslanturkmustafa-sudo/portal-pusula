import { managedProjectIdsSchema } from "./user-management-validation";
import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import type { ProjectScope } from "@/platform/auth/project-access";

const projectIdsSchema = managedProjectIdsSchema.unwrap();

export async function readUserProjectScope(connection: PoolConnection, accountId: string): Promise<ProjectScope> {
  const [rows] = await connection.execute<(RowDataPacket & { project_ids: unknown })[]>(
    "SELECT project_ids FROM user_project_access WHERE user_account_id = ?", [accountId],
  );
  if (!rows[0]) return null;
  const value = rows[0].project_ids;
  return projectIdsSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

export async function replaceUserProjectScope(connection: PoolConnection, accountId: string, scope: ProjectScope): Promise<void> {
  if (scope === null) {
    await connection.execute("DELETE FROM user_project_access WHERE user_account_id = ?", [accountId]);
    return;
  }
  const ids = projectIdsSchema.parse(scope);
  if (ids.length) {
    const [rows] = await connection.execute<(RowDataPacket & { id: string })[]>(
      `SELECT id FROM project WHERE id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`, ids,
    );
    if (rows.length !== ids.length) throw new z.ZodError([{ code: "custom", path: ["projectIds"], message: "Seçilen proje bulunamadı." }]);
  }
  await connection.execute(
    "INSERT INTO user_project_access (user_account_id, project_ids) VALUES (?, ?) ON DUPLICATE KEY UPDATE project_ids = VALUES(project_ids)",
    [accountId, JSON.stringify(ids)],
  );
}
