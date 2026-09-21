import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createManagedUser, updateManagedUser, validateAccountPrincipalSession } from "@/features/account/service";
import { createProject, listProjects } from "@/features/projects/service";
import { createCustomer, listCustomers } from "@/features/customers/service";
import { createTask, listTasks, updateTask } from "@/features/tasks/service";
import { changeTaskLifecycle } from "@/features/tasks/lifecycle-service";
import { getCustomerTaskReport } from "@/features/task-reports/service";
import { getTodayOverview } from "@/features/today/service";
import { registerMySqlPoolDatabase } from "@/platform/database/mysql-session-contract";
import { projectScope } from "@/platform/auth/project-access";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const ownerId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const permissions = ["customers.read", "projects.read", "projects.write", "tasks.read", "tasks.write", "tasks.reports.export"] as const;
const context = { actorId: ownerId, correlationId: "project-access-disposable-db" };

function disposableEnvironment() {
  const expected = { DB_HOST: "127.0.0.1", DB_NAME: "portal_pusula_migration_test", DB_USER: "portal_pusula_test", DB_PASSWORD: "portal-pusula-local-test-only" };
  const port = Number(process.env.DB_PORT);
  if (!enabled || Object.entries(expected).some(([key, value]) => process.env[key] !== value) || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306) throw new Error("Disposable loopback database required.");
  return { ...expected, DB_PORT: String(port) };
}

async function migrate() {
  const env: NodeJS.ProcessEnv = { ...disposableEnvironment(), NODE_ENV: "test" };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"]) if (process.env[key]) env[key] = process.env[key];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "ignore", windowsHide: true });
    child.once("error", () => reject(new Error("Disposable migration could not start.")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Disposable migration failed.")));
  });
}

describe.skipIf(!enabled).sequential("project access on disposable MariaDB", () => {
  let pool: Pool;
  let projectA: string, projectB: string, customerId: string, taskA: string, taskB: string;

  beforeAll(async () => {
    const env = disposableEnvironment();
    await migrate();
    pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, charset: "utf8mb4", timezone: "Z", dateStrings: true, connectionLimit: 4, multipleStatements: false, connectTimeout: 5000 });
    registerMySqlPoolDatabase(pool, env.DB_NAME);
    for (const [id, role] of [[ownerId, "owner"], [memberId, "member"]]) {
      await pool.execute(`INSERT INTO user_account (id, email, display_name, role, password_hash, password_changed_at_utc, created_at_utc, updated_at_utc)
        VALUES (?, ?, 'Synthetic account', ?, ?, '2026-01-01', '2026-01-01', '2026-01-01')`,
      [id, `${role}@example.invalid`, role, `scrypt:32768:8:1:${"a".repeat(22)}:${"b".repeat(86)}`]);
    }
    projectA = (await createProject(pool, { displayName: "Allowed project", projectType: "product", shortCode: "ALLOW" }, context)).id;
    projectB = (await createProject(pool, { displayName: "Other project", projectType: "product", shortCode: "OTHER" }, context)).id;
    customerId = (await createCustomer(pool, { displayName: "Shared customer", shortCode: "SHARED", projectIds: [projectA, projectB], contactNote: "Shared private note", email: null, phone: null, status: "active" }, context)).id;
    taskA = (await createTask(pool, { title: "Allowed task", customerId, projectId: projectA, dueOn: "2026-09-21" }, context)).id;
    taskB = (await createTask(pool, { title: "Other task", customerId, projectId: projectB, dueOn: "2026-09-21" }, context)).id;
    await createTask(pool, { title: "Unscoped task", customerId, dueOn: "2026-09-21" }, context);
  }, 30_000);
  afterAll(async () => { if (pool) await pool.end(); });

  it("applies the full real migration with matching account FK and preserves existing access", async () => {
    const expected = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries.length;
    const [journal] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM __drizzle_migrations");
    expect(Number(journal[0].total)).toBe(expected);
    const [columns] = await pool.execute<RowDataPacket[]>("SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_project_access' AND COLUMN_NAME = 'user_account_id'");
    expect(columns[0].COLLATION_NAME).toBe("ascii_bin");
    expect(await validateAccountPrincipalSession(pool, memberId, 1)).toMatchObject({ projectIds: null });
    await expect(pool.execute("INSERT INTO user_project_access VALUES (?, '[]')", ["99999999-9999-4999-8999-999999999999"])).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
  });

  it("limits projects, shared customer links, task reports and today's summary to the saved grant", async () => {
    await updateManagedUser(pool, memberId, { permissions: [...permissions], status: "active", projectIds: [projectA] }, context);
    const access = await validateAccountPrincipalSession(pool, memberId, 2);
    expect(access?.projectIds).toEqual([projectA]);
    const scope = access!.projectIds!;
    expect((await listProjects(pool, scope)).map((p) => p.id)).toEqual([projectA]);
    expect((await listTasks(pool, scope)).map((t) => t.id)).toEqual([taskA]);
    const customers = await listCustomers(pool, { projectIds: scope, includeContact: true, includeBilling: true, includeVisits: true });
    expect(customers[0].projects.map((p) => p.id)).toEqual([projectA]);
    expect(customers[0].contactNote).toBeNull();
    expect(customers[0].overview).toEqual({ nextVisitOn: null });
    const report = await getCustomerTaskReport(pool, { customerId, status: "all" }, new Date("2026-09-21T10:00:00Z"), scope);
    expect(report.tasks.map((t) => t.id)).toEqual([taskA]);
    const today = await getTodayOverview(pool, "2026-09-21", { projectIds: scope, canReadTasks: true, canReadVisits: true, canReadFinance: true });
    expect(today.tasks.map((t) => t.id)).toEqual([taskA]);
    expect(today.visits).toEqual([]);
    expect(today.financeItems).toBeUndefined();
    expect((await listProjects(pool, projectScope({ role: "owner", projectIds: [] }))).length).toBe(2);
  });

  it("allows a scoped edit and rejects cross-project edits, moves, archive and projectless creation without writes", async () => {
    const memberContext = { ...context, actorId: memberId, projectIds: [projectA] };
    await updateTask(pool, taskA, { version: 1, title: "Allowed edit" }, memberContext);
    await expect(updateTask(pool, taskB, { version: 1, title: "Forbidden edit" }, memberContext)).rejects.toThrow("Project access denied");
    await expect(updateTask(pool, taskA, { version: 2, projectId: projectB }, memberContext)).rejects.toThrow("Project access denied");
    await expect(createTask(pool, { title: "Forbidden creation" }, memberContext)).rejects.toThrow("Project access denied");
    await expect(changeTaskLifecycle(pool, taskB, { action: "archive", version: 1, reason: "Forbidden archive" }, memberContext)).rejects.toThrow("Project access denied");
    const tasks = await listTasks(pool);
    expect(tasks.find((t) => t.id === taskA)).toMatchObject({ title: "Allowed edit", projectId: projectA, version: 2 });
    expect(tasks.find((t) => t.id === taskB)).toMatchObject({ title: "Other task", version: 1, archivedAtUtc: null });
    expect(tasks).toHaveLength(3);
  });

  it("rolls back an invalid grant without changing the session or previous scope", async () => {
    await expect(updateManagedUser(pool, memberId, { permissions: [...permissions], status: "active", projectIds: ["99999999-9999-4999-8999-999999999999"] }, context)).rejects.toThrow();
    expect(await validateAccountPrincipalSession(pool, memberId, 2)).toMatchObject({ projectIds: [projectA] });
  });

  it("revokes the old session and all project access when the last grant is removed", async () => {
    await updateManagedUser(pool, memberId, { permissions: [...permissions], status: "active", projectIds: [] }, context);
    expect(await validateAccountPrincipalSession(pool, memberId, 2)).toBeNull();
    const access = await validateAccountPrincipalSession(pool, memberId, 3);
    expect(access?.projectIds).toEqual([]);
    expect(await listProjects(pool, access!.projectIds)).toEqual([]);
    expect(await listTasks(pool, access!.projectIds)).toEqual([]);
    await expect(getCustomerTaskReport(pool, { customerId, status: "all" }, undefined, access!.projectIds)).rejects.toThrow("customer was not found");
  });

  it("creates new accounts without project access by default", async () => {
    const user = await createManagedUser(pool, { displayName: "New member", email: "new@example.invalid", password: "portal-pusula-local-test-only", confirmation: "portal-pusula-local-test-only", permissions: ["projects.read"] }, context);
    expect(user.projectIds).toEqual([]);
    expect(await validateAccountPrincipalSession(pool, user.id, 1)).toMatchObject({ projectIds: [] });
  });
});
