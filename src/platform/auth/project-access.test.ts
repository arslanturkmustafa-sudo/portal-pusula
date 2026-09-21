// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { hasPermission } from "./permissions";
import { projectScope, projectScopeSql, requireProjectAccess } from "./project-access";
import { canTransfer } from "@/features/bypusula/access";
import { managedProjectIdsSchema } from "@/features/account/user-management-validation";
import { readUserProjectScope, replaceUserProjectScope } from "@/features/account/project-access-repository";
import type { PoolConnection } from "mysql2/promise";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";

describe("project access boundaries", () => {
  it("distinguishes all projects, selected projects, and no projects", () => {
    expect(() => requireProjectAccess(null, b)).not.toThrow();
    expect(() => requireProjectAccess([a], a)).not.toThrow();
    expect(() => requireProjectAccess([a], b)).toThrow("Project access denied");
    expect(() => requireProjectAccess([a], null)).toThrow();
    expect(() => requireProjectAccess([], a)).toThrow();
    expect(projectScope({ role: "owner", projectIds: [] })).toBeNull();
    expect(projectScopeSql("project_id", []).sql).toBe("1 = 0");
  });

  it("blocks portfolio-wide modules and imports even if grants remain stored", () => {
    const member = { role: "member" as const, projectIds: [a], permissions: ["tasks.read", "tasks.write", "customers.read", "projects.read", "finance.reports.read", "contracts.read", "daily-plan.read", "audit.read"] as const };
    expect(hasPermission(member, "tasks.read")).toBe(true);
    for (const code of ["finance.reports.read", "contracts.read", "daily-plan.read", "audit.read"] as const) expect(hasPermission(member, code)).toBe(false);
    expect(canTransfer({ ...member, kind: "account", accountId: a, credentialVersion: 1, displayName: "Member", email: "member@example.test", passwordChangedAtUtc: "2026-09-17 00:00:00.000000" })).toBe(false);
  });

  it("rejects duplicate and malformed project grants", () => {
    expect(() => managedProjectIdsSchema.parse([a, a])).toThrow();
    expect(() => managedProjectIdsSchema.parse(["not-a-project"])).toThrow();
  });

  it("persists removal as an empty list and preserves existing unrestricted accounts", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const connection = { execute } as unknown as PoolConnection;
    expect(await readUserProjectScope(connection, a)).toBeNull();
    await replaceUserProjectScope(connection, a, []);
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("INSERT INTO user_project_access"), [a, "[]"]);
    execute.mockResolvedValueOnce([[{ project_ids: "[]" }], []]);
    expect(await readUserProjectScope(connection, a)).toEqual([]);
    execute.mockResolvedValueOnce([[{ project_ids: "invalid" }], []]);
    await expect(readUserProjectScope(connection, a)).rejects.toThrow();
  });

  it("refuses a grant for a nonexistent project before saving", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await expect(replaceUserProjectScope({ execute } as unknown as PoolConnection, a, [b])).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
