// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class TaskAssigneeNotFoundError extends Error {}
  class TaskCustomerNotFoundError extends Error {}
  return {
    authenticateAdminRequest: vi.fn(),
    createTask: vi.fn(),
    error: vi.fn(),
    listTasks: vi.fn(),
    parseCreate: vi.fn(),
    requestLogger: vi.fn(),
    TaskAssigneeNotFoundError,
    TaskCustomerNotFoundError,
  };
});

vi.mock("@/features/tasks", () => ({
  createTask: mocks.createTask,
  createTaskInputSchema: { parse: mocks.parseCreate },
  listTasks: mocks.listTasks,
  TaskAssigneeNotFoundError: mocks.TaskAssigneeNotFoundError,
  TaskCustomerNotFoundError: mocks.TaskCustomerNotFoundError,
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

import { GET, POST } from "@/app/api/tasks/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const task = {
  assigneeEmail: "yonetici@example.com",
  assigneeUserAccountId: accountId,
  completedAtUtc: null,
  createdAtUtc: "2026-09-02 10:00:00.000000",
  customerCode: null,
  customerId: null,
  customerName: null,
  description: null,
  dueOn: null,
  id: "30000000-0000-4000-8000-000000000001",
  priority: "normal",
  status: "backlog",
  title: "Yeni görev",
  updatedAtUtc: "2026-09-02 10:00:00.000000",
  version: 1,
};
const principal = {
  accountId,
  credentialVersion: 1,
  email: "yonetici@example.com",
  kind: "account" as const,
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
};

function postRequest(origin = "https://portal.example.test") {
  return new NextRequest("https://portal.example.test/api/tasks", {
    body: JSON.stringify({ title: "Yeni görev" }),
    headers: {
      "content-type": "application/json",
      origin,
      "x-correlation-id": "22222222-2222-4222-8222-222222222222",
    },
    method: "POST",
  });
}

describe("task collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue(principal);
    mocks.createTask.mockResolvedValue(task);
    mocks.listTasks.mockResolvedValue([task]);
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: mocks.error });
  });

  it("returns the authenticated no-store Kanban collection", async () => {
    const response = await GET(
      new NextRequest("https://portal.example.test/api/tasks"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks: [task] });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("creates a task with the authenticated account as write actor", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ task });
    expect(mocks.createTask).toHaveBeenCalledWith(
      {},
      { title: "Yeni görev" },
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
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("returns a generic 503 and logs only an allowlisted database code", async () => {
    mocks.createTask.mockRejectedValue({
      code: "ER_NO_SUCH_TABLE",
      message: "database-message-sentinel",
      sql: "database-sql-sentinel",
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sentinel");
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ mysqlErrorCode: "ER_NO_SUCH_TABLE" }),
      "Task API database operation failed: ER_NO_SUCH_TABLE",
    );
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
      "database-message-sentinel",
    );
  });
});
