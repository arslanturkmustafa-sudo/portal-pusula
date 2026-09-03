// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class TaskAssigneeNotFoundError extends Error {}
  class TaskCustomerNotFoundError extends Error {}
  class TaskNotFoundError extends Error {}
  class TaskProjectNotFoundError extends Error {}
  class TaskVersionConflictError extends Error {}
  return {
    authenticateAdminRequest: vi.fn(),
    parseUpdate: vi.fn(),
    requestLogger: vi.fn(),
    TaskAssigneeNotFoundError,
    TaskCustomerNotFoundError,
    TaskNotFoundError,
    TaskProjectNotFoundError,
    TaskVersionConflictError,
    updateTask: vi.fn(),
  };
});

vi.mock("@/features/tasks", () => ({
  TaskAssigneeNotFoundError: mocks.TaskAssigneeNotFoundError,
  TaskCustomerNotFoundError: mocks.TaskCustomerNotFoundError,
  TaskNotFoundError: mocks.TaskNotFoundError,
  TaskProjectNotFoundError: mocks.TaskProjectNotFoundError,
  TaskVersionConflictError: mocks.TaskVersionConflictError,
  updateTask: mocks.updateTask,
  updateTaskInputSchema: { parse: mocks.parseUpdate },
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

import { PATCH } from "@/app/api/tasks/[id]/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const taskId = "30000000-0000-4000-8000-000000000001";
const principal = {
  accountId,
  credentialVersion: 1,
  email: "yonetici@example.com",
  kind: "account" as const,
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
};
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
  id: taskId,
  priority: "high",
  projectCode: null,
  projectId: null,
  projectName: null,
  status: "todo",
  title: "Güncellenen görev",
  updatedAtUtc: "2026-09-02 10:10:00.000000",
  version: 2,
};

function request(origin = "https://portal.example.test") {
  return new NextRequest(`https://portal.example.test/api/tasks/${taskId}`, {
    body: JSON.stringify({ priority: "high", version: 1 }),
    headers: {
      "content-type": "application/json",
      origin,
      "x-correlation-id": "22222222-2222-4222-8222-222222222222",
    },
    method: "PATCH",
  });
}

const context = { params: Promise.resolve({ id: taskId }) };

describe("task item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue(principal);
    mocks.parseUpdate.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
    mocks.updateTask.mockResolvedValue(task);
  });

  it("updates a task with its optimistic version", async () => {
    const response = await PATCH(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ task });
    expect(mocks.updateTask).toHaveBeenCalledWith(
      {},
      taskId,
      { priority: "high", version: 1 },
      {
        actorId: accountId,
        correlationId: "22222222-2222-4222-8222-222222222222",
      },
    );
  });

  it("maps a stale task version to a stable conflict response", async () => {
    mocks.updateTask.mockRejectedValue(new mocks.TaskVersionConflictError());

    const response = await PATCH(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "version_conflict",
    });
  });

  it("rejects cross-origin writes before parsing or mutation", async () => {
    const response = await PATCH(request("https://attacker.example"), context);

    expect(response.status).toBe(403);
    expect(mocks.parseUpdate).not.toHaveBeenCalled();
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
});
