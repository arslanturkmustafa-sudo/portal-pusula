// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class ProjectNotFoundError extends Error {}
  class ProjectShortCodeConflictError extends Error {}
  class ProjectVersionConflictError extends Error {}
  return {
    authenticateAdminRequest: vi.fn(),
    parseUpdate: vi.fn(),
    ProjectNotFoundError,
    ProjectShortCodeConflictError,
    ProjectVersionConflictError,
    requestLogger: vi.fn(),
    updateProject: vi.fn(),
  };
});

vi.mock("@/features/projects", () => ({
  ProjectNotFoundError: mocks.ProjectNotFoundError,
  ProjectShortCodeConflictError: mocks.ProjectShortCodeConflictError,
  ProjectVersionConflictError: mocks.ProjectVersionConflictError,
  updateProject: mocks.updateProject,
  updateProjectInputSchema: { parse: mocks.parseUpdate },
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));
vi.mock("@/platform/logging/logger", () => ({
  requestLogger: mocks.requestLogger,
}));

import { PATCH } from "@/app/api/projects/[id]/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const principal = {
  accountId,
  credentialVersion: 1,
  email: "yonetici@example.com",
  kind: "account" as const,
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
};
const body = {
  budgetAmount: null,
  displayName: "ByPusula",
  internalNote: null,
  objective: null,
  projectType: "product",
  shortCode: "BYPUSULA",
  startsOn: null,
  status: "active",
  targetEndsOn: null,
  version: 1,
};

function request(requestBody: Readonly<Record<string, unknown>> = body) {
  return new NextRequest(
    `https://portal.example.test/api/projects/${projectId}`,
    {
      body: JSON.stringify(requestBody),
      headers: {
        "content-type": "application/json",
        origin: "https://portal.example.test",
        "x-correlation-id": "22222222-2222-4222-8222-222222222222",
      },
      method: "PATCH",
    },
  );
}

describe("project item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue(principal);
    mocks.parseUpdate.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
    mocks.updateProject.mockResolvedValue({ id: projectId, version: 2 });
  });

  it("updates a project with its optimistic version", async () => {
    const response = await PATCH(request(), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.updateProject).toHaveBeenCalledWith(
      {},
      projectId,
      body,
      {
        actorId: accountId,
        correlationId: "22222222-2222-4222-8222-222222222222",
      },
    );
  });

  it("maps a stale version to a stable conflict response", async () => {
    mocks.updateProject.mockRejectedValue(
      new mocks.ProjectVersionConflictError(),
    );
    const response = await PATCH(request(), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ status: "version_conflict" });
  });

  it("accepts a schema-valid Unicode body above the former 16 KiB limit", async () => {
    const largeBody = {
      ...body,
      internalNote: "界".repeat(2000),
      objective: "界".repeat(4000),
    };
    expect(Buffer.byteLength(JSON.stringify(largeBody), "utf8")).toBeGreaterThan(
      16_384,
    );

    const response = await PATCH(request(largeBody), {
      params: Promise.resolve({ id: projectId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.parseUpdate).toHaveBeenCalledWith(largeBody);
  });
});
