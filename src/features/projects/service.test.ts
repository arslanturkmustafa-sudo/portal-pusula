// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findProjectForUpdate: vi.fn(),
  insertProjectRecord: vi.fn(),
  listProjectRecords: vi.fn(),
  updateProjectRecord: vi.fn(),
}));

vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
  insertProjectRecord: mocks.insertProjectRecord,
  listProjectRecords: mocks.listProjectRecords,
  updateProjectRecord: mocks.updateProjectRecord,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  createProject,
  ProjectVersionConflictError,
  updateProject,
} from "@/features/projects/service";

const projectId = "30000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-03T08:00:00.000Z");
const nowSql = "2026-09-03 08:00:00.000000";
const before = {
  budgetAmount: null,
  closedAtUtc: null,
  createdAtUtc: "2026-09-01 08:00:00.000000",
  currency: "TRY" as const,
  displayName: "ByPusula",
  id: projectId,
  internalNote: null,
  objective: "Mevcut durumu analiz etmek",
  projectType: "product" as const,
  shortCode: "BYPUSULA",
  startsOn: null,
  status: "active" as const,
  targetEndsOn: null,
  updatedAtUtc: "2026-09-01 08:00:00.000000",
  version: 2,
};
const context = {
  actorId: accountId,
  correlationId: "project-service-test",
  now,
};

describe("project service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectForUpdate.mockResolvedValue(before);
    mocks.updateProjectRecord.mockResolvedValue(true);
  });

  it("creates and audits an active portfolio record", async () => {
    const created = await createProject(
      {} as Pool,
      {
        displayName: "  OptiPusula ",
        projectType: "product",
        shortCode: "optipusula",
      },
      context,
    );

    expect(created).toMatchObject({
      closedAtUtc: null,
      displayName: "OptiPusula",
      shortCode: "OPTIPUSULA",
      status: "active",
      version: 1,
    });
    expect(mocks.insertProjectRecord).toHaveBeenCalledWith(
      expect.anything(),
      created,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "project.created",
        actorId: accountId,
        entityType: "project",
      }),
    );
  });

  it("closes a project and increments its optimistic version", async () => {
    const updated = await updateProject(
      {} as Pool,
      projectId,
      {
        budgetAmount: null,
        displayName: before.displayName,
        internalNote: null,
        objective: before.objective,
        projectType: before.projectType,
        shortCode: before.shortCode,
        startsOn: null,
        status: "completed",
        targetEndsOn: null,
        version: 2,
      },
      context,
    );

    expect(updated).toMatchObject({
      closedAtUtc: nowSql,
      status: "completed",
      version: 3,
    });
    expect(mocks.updateProjectRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ closedAtUtc: nowSql, version: 3 }),
      2,
    );
  });

  it("rejects a stale project version before writing", async () => {
    await expect(
      updateProject(
        {} as Pool,
        projectId,
        {
          budgetAmount: null,
          displayName: before.displayName,
          internalNote: null,
          objective: before.objective,
          projectType: before.projectType,
          shortCode: before.shortCode,
          startsOn: null,
          status: before.status,
          targetEndsOn: null,
          version: 1,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
    expect(mocks.updateProjectRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
