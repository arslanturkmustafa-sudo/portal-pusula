// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class ProjectShortCodeConflictError extends Error {}
  return {
    authenticateAdminRequest: vi.fn(),
    createProject: vi.fn(),
    listProjects: vi.fn(),
    parseCreate: vi.fn(),
    ProjectShortCodeConflictError,
    requestLogger: vi.fn(),
  };
});

vi.mock("@/features/projects", () => ({
  createProject: mocks.createProject,
  createProjectInputSchema: { parse: mocks.parseCreate },
  listProjects: mocks.listProjects,
  ProjectShortCodeConflictError: mocks.ProjectShortCodeConflictError,
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

import { GET, POST } from "@/app/api/projects/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const principal = {
  accountId,
  credentialVersion: 1,
  email: "yonetici@example.com",
  kind: "account" as const,
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
};
const project = { id: "30000000-0000-4000-8000-000000000001" };

function postRequest(
  origin = "https://portal.example.test",
  body: Readonly<Record<string, unknown>> = {
    displayName: "ByPusula",
    projectType: "product",
    shortCode: "BYPUSULA",
  },
) {
  return new NextRequest("https://portal.example.test/api/projects", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      "x-correlation-id": "22222222-2222-4222-8222-222222222222",
    },
    method: "POST",
  });
}

describe("project collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue(principal);
    mocks.createProject.mockResolvedValue(project);
    mocks.listProjects.mockResolvedValue([project]);
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("lists and creates authenticated no-store project records", async () => {
    const listResponse = await GET(
      new NextRequest("https://portal.example.test/api/projects"),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({ projects: [project] });
    expect(listResponse.headers.get("cache-control")).toContain("no-store");

    const createResponse = await POST(postRequest());
    expect(createResponse.status).toBe(201);
    expect(mocks.createProject).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ shortCode: "BYPUSULA" }),
      {
        actorId: accountId,
        correlationId: "22222222-2222-4222-8222-222222222222",
      },
    );
  });

  it("rejects unauthenticated and cross-origin writes before mutation", async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce(null);
    expect((await POST(postRequest())).status).toBe(401);
    mocks.authenticateAdminRequest.mockResolvedValueOnce(principal);
    expect((await POST(postRequest("https://attacker.example"))).status).toBe(403);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("accepts a schema-valid Unicode body above the former 16 KiB limit", async () => {
    const largeBody = {
      displayName: "ByPusula",
      internalNote: "界".repeat(2000),
      objective: "界".repeat(4000),
      projectType: "product",
      shortCode: "BYPUSULA",
    };
    expect(Buffer.byteLength(JSON.stringify(largeBody), "utf8")).toBeGreaterThan(
      16_384,
    );

    const response = await POST(
      postRequest("https://portal.example.test", largeBody),
    );

    expect(response.status).toBe(201);
    expect(mocks.parseCreate).toHaveBeenCalledWith(largeBody);
  });
});
