// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findTaskGeneratedFromTaskId,
  listTaskRecords,
  updateTaskRecord,
} from "@/features/tasks/repository";

const taskRow = {
  archive_reason: null,
  archived_at_utc: null,
  archived_by_user_account_id: null,
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
  linked_visit_id: null,
  priority: "high",
  project_code: "BYPUSULA",
  project_id: "40000000-0000-4000-8000-000000000001",
  project_name: "ByPusula",
  recurrence_anchor_day: null,
  recurrence_ends_on: null,
  recurrence_frequency: null,
  recurrence_generated_from_task_id: null,
  recurrence_series_id: null,
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
        recurrenceFrequency: null,
        status: "todo",
        visitLinked: false,
      }),
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/LEFT JOIN project[\s\S]*LEFT JOIN customer[\s\S]*LEFT JOIN user_account[\s\S]*LEFT JOIN work_task_visit/iu),
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("FIELD(task.status"));
  });

  it("marks a task projection as visit-linked without exposing the visit id", async () => {
    const execute = vi.fn().mockResolvedValue([
      [{ ...taskRow, linked_visit_id: "50000000-0000-4000-8000-000000000001" }],
      [],
    ]);

    const result = await listTaskRecords(
      { execute } as unknown as PoolConnection,
    );

    expect(result).toEqual([expect.objectContaining({ visitLinked: true })]);
    expect(result[0]).not.toHaveProperty("linkedVisitId");
  });

  it("fences an update with the caller's expected version", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const task = {
      archiveReason: null,
      archivedAtUtc: null,
      archivedByUserAccountId: null,
      assigneeUserAccountId: taskRow.assignee_user_account_id,
      completedAtUtc: null,
      createdAtUtc: taskRow.created_at_utc,
      customerId: taskRow.customer_id,
      description: null,
      dueOn: taskRow.due_on,
      id: taskRow.id,
      priority: "high" as const,
      projectId: taskRow.project_id,
      recurrenceAnchorDay: null,
      recurrenceEndsOn: null,
      recurrenceFrequency: null,
      recurrenceGeneratedFromTaskId: null,
      recurrenceSeriesId: null,
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

  it("locks the generated occurrence identity used by the idempotency fence", async () => {
    const generatedId = "30000000-0000-4000-8000-000000000002";
    const execute = vi.fn().mockResolvedValue([[{ id: generatedId }], []]);

    await expect(
      findTaskGeneratedFromTaskId(
        { execute } as unknown as PoolConnection,
        taskRow.id,
      ),
    ).resolves.toBe(generatedId);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/recurrence_generated_from_task_id = \?[\s\S]*FOR UPDATE/iu),
      [taskRow.id],
    );
  });
});
