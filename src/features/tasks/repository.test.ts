// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listTaskRecords,
  updateTaskRecord,
} from "@/features/tasks/repository";

const taskRow = {
  assignee_email: "yonetici@example.com",
  assignee_user_account_id: "10000000-0000-4000-8000-000000000001",
  completed_at_utc: null,
  created_at_utc: "2026-09-02 09:00:00.000000",
  customer_code: "ONCU",
  customer_id: "20000000-0000-4000-8000-000000000001",
  customer_name: "Öncü Üretim",
  description: null,
  due_on: "2026-09-05",
  id: "30000000-0000-4000-8000-000000000001",
  priority: "high",
  project_code: "BYPUSULA",
  project_id: "40000000-0000-4000-8000-000000000001",
  project_name: "ByPusula",
  status: "todo",
  title: "Süreç haritasını tamamla",
  updated_at_utc: "2026-09-02 09:00:00.000000",
  version: 1,
};

describe("task repository", () => {
  it("returns customer and assignee projections in deterministic board order", async () => {
    const execute = vi.fn().mockResolvedValue([[taskRow], []]);

    await expect(
      listTaskRecords({ execute } as unknown as PoolConnection),
    ).resolves.toEqual([
      expect.objectContaining({
        assigneeEmail: "yonetici@example.com",
        customerCode: "ONCU",
        customerName: "Öncü Üretim",
        dueOn: "2026-09-05",
        projectCode: "BYPUSULA",
        projectName: "ByPusula",
        status: "todo",
      }),
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/LEFT JOIN project[\s\S]*LEFT JOIN customer[\s\S]*LEFT JOIN user_account/iu),
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("FIELD(task.status"));
  });

  it("fences an update with the caller's expected version", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const task = {
      assigneeUserAccountId: taskRow.assignee_user_account_id,
      completedAtUtc: null,
      createdAtUtc: taskRow.created_at_utc,
      customerId: taskRow.customer_id,
      description: null,
      dueOn: taskRow.due_on,
      id: taskRow.id,
      priority: "high" as const,
      projectId: taskRow.project_id,
      status: "in_progress" as const,
      title: taskRow.title,
      updatedAtUtc: "2026-09-02 10:00:00.000000",
      version: 2,
    };

    await expect(
      updateTaskRecord(
        { execute } as unknown as PoolConnection,
        task,
        1,
      ),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE id = \? AND version = \?/u),
      expect.arrayContaining([2, task.id, 1]),
    );
  });
});
