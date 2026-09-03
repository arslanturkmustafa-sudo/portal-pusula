// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  findTaskRecordById: vi.fn(),
  findTaskStateForUpdate: vi.fn(),
  findUserAccountById: vi.fn(),
  insertTaskRecord: vi.fn(),
  listTaskRecords: vi.fn(),
  replaceTaskProjectRecord: vi.fn(),
  updateTaskRecord: vi.fn(),
}));

vi.mock("@/features/account/repository", () => ({
  findUserAccountById: mocks.findUserAccountById,
}));
vi.mock("@/features/customers/repository", () => ({
  findCustomerForUpdate: mocks.findCustomerForUpdate,
}));
vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
}));
vi.mock("@/features/tasks/repository", () => ({
  findTaskRecordById: mocks.findTaskRecordById,
  findTaskStateForUpdate: mocks.findTaskStateForUpdate,
  insertTaskRecord: mocks.insertTaskRecord,
  listTaskRecords: mocks.listTaskRecords,
  replaceTaskProjectRecord: mocks.replaceTaskProjectRecord,
  updateTaskRecord: mocks.updateTaskRecord,
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
  createTask,
  TaskAssigneeNotFoundError,
  TaskVersionConflictError,
  updateTask,
} from "@/features/tasks/service";

const accountId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const taskId = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-02T10:00:00.000Z");
const nowSql = "2026-09-02 10:00:00.000000";
const context = {
  actorId: accountId,
  correlationId: "task-service-test",
  now,
};
const before = {
  assigneeUserAccountId: accountId,
  completedAtUtc: null,
  createdAtUtc: "2026-09-02 09:00:00.000000",
  customerId,
  description: null,
  dueOn: "2026-09-05",
  id: taskId,
  priority: "normal" as const,
  projectId: null,
  status: "todo" as const,
  title: "Süreç haritasını tamamla",
  updatedAtUtc: "2026-09-02 09:00:00.000000",
  version: 4,
};
const projection = {
  ...before,
  assigneeEmail: "yonetici@example.com",
  customerCode: "ONCU",
  customerName: "Öncü Üretim",
};

describe("task service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerForUpdate.mockResolvedValue({ id: customerId });
    mocks.findUserAccountById.mockResolvedValue({
      id: accountId,
      status: "active",
    });
    mocks.findProjectForUpdate.mockResolvedValue({ id: "project-id" });
    mocks.findTaskRecordById.mockResolvedValue(projection);
    mocks.findTaskStateForUpdate.mockResolvedValue(before);
    mocks.updateTaskRecord.mockResolvedValue(true);
  });

  it("assigns a new task to the authenticated account and audits it", async () => {
    await createTask(
      {} as Pool,
      {
        customerId,
        description: null,
        dueOn: "2026-09-05",
        priority: "high",
        status: "backlog",
        title: "Süreç haritasını tamamla",
      },
      context,
    );

    expect(mocks.insertTaskRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assigneeUserAccountId: accountId,
        completedAtUtc: null,
        customerId,
        version: 1,
      }),
    );
    expect(mocks.replaceTaskProjectRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      null,
      nowSql,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "task.created",
        actorId: accountId,
        entityType: "work_task",
      }),
    );
  });

  it("keeps the default assignee empty for a legacy or development principal", async () => {
    await createTask(
      {} as Pool,
      {
        customerId: null,
        description: null,
        dueOn: null,
        priority: "normal",
        status: "backlog",
        title: "Bağımsız görev",
      },
      { correlationId: "legacy-task", now },
    );

    expect(mocks.insertTaskRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assigneeUserAccountId: null }),
    );
    expect(mocks.findUserAccountById).not.toHaveBeenCalled();
  });

  it("sets completion time and increments the optimistic version", async () => {
    await updateTask(
      {} as Pool,
      taskId,
      { status: "done", version: 4 },
      context,
    );

    expect(mocks.updateTaskRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        completedAtUtc: nowSql,
        status: "done",
        version: 5,
      }),
      4,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "task.updated",
        beforeSummary: expect.objectContaining({ version: 4 }),
        afterSummary: expect.objectContaining({ status: "done", version: 5 }),
      }),
    );
  });

  it("clears completion time when a completed task is reopened", async () => {
    mocks.findTaskStateForUpdate.mockResolvedValue({
      ...before,
      completedAtUtc: "2026-09-02 09:30:00.000000",
      status: "done",
    });

    await updateTask(
      {} as Pool,
      taskId,
      { status: "in_progress", version: 4 },
      context,
    );

    expect(mocks.updateTaskRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completedAtUtc: null, status: "in_progress" }),
      4,
    );
  });

  it("rejects a stale version before writing or auditing", async () => {
    await expect(
      updateTask(
        {} as Pool,
        taskId,
        { priority: "urgent", version: 3 },
        context,
      ),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
    expect(mocks.updateTaskRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an inactive explicit assignee", async () => {
    mocks.findUserAccountById.mockResolvedValue({
      id: accountId,
      status: "disabled",
    });

    await expect(
      createTask(
        {} as Pool,
        {
          assigneeUserAccountId: accountId,
          customerId: null,
          description: null,
          dueOn: null,
          priority: "normal",
          status: "todo",
          title: "Atanacak görev",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(TaskAssigneeNotFoundError);
    expect(mocks.insertTaskRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
