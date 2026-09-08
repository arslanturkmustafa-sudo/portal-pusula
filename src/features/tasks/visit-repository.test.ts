// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findTaskVisitLinkForUpdate,
  insertTaskVisitRecord,
  listVisitWorkItemReferences,
} from "@/features/tasks/visit-repository";

describe("task visit repository", () => {
  it("locks and returns the task-to-visit link inside the caller transaction", async () => {
    const execute = vi.fn().mockResolvedValue([
      [{ task_id: "30000000-0000-4000-8000-000000000001", visit_id: "40000000-0000-4000-8000-000000000001" }],
      [],
    ]);

    await expect(
      findTaskVisitLinkForUpdate(
        { execute } as unknown as PoolConnection,
        "30000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      taskId: "30000000-0000-4000-8000-000000000001",
      visitId: "40000000-0000-4000-8000-000000000001",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/FROM work_task_visit[\s\S]*WHERE task_id = \?[\s\S]*FOR UPDATE/u),
      ["30000000-0000-4000-8000-000000000001"],
    );
  });

  it("returns null when the locked task has no visit link", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);

    await expect(
      findTaskVisitLinkForUpdate(
        { execute } as unknown as PoolConnection,
        "30000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBeNull();
  });

  it("lists task identities already linked to a visit", async () => {
    const visitId = "40000000-0000-4000-8000-000000000001";
    const execute = vi.fn().mockResolvedValue([
      [
        {
          task_id: "30000000-0000-4000-8000-000000000001",
          title: "Mevcut uygulama",
        },
      ],
      [],
    ]);

    await expect(
      listVisitWorkItemReferences(
        { execute } as unknown as PoolConnection,
        visitId,
      ),
    ).resolves.toEqual([
      {
        taskId: "30000000-0000-4000-8000-000000000001",
        title: "Mevcut uygulama",
      },
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /FROM work_task_visit AS task_visit[\s\S]*INNER JOIN work_task AS task[\s\S]*WHERE task_visit.visit_id = \?/u,
      ),
      [visitId],
    );
  });

  it("inserts one immutable task-to-visit link with caller timestamps", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);

    await insertTaskVisitRecord(
      { execute } as unknown as PoolConnection,
      "30000000-0000-4000-8000-000000000001",
      "40000000-0000-4000-8000-000000000001",
      "2026-09-03 10:00:00.000000",
    );

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_task_visit"),
      [
        "30000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000001",
        "2026-09-03 10:00:00.000000",
        "2026-09-03 10:00:00.000000",
      ],
    );
  });

  it("fails closed when the database does not insert exactly one link", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 0 }, []]);

    await expect(
      insertTaskVisitRecord(
        { execute } as unknown as PoolConnection,
        "30000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000001",
        "2026-09-03 10:00:00.000000",
      ),
    ).rejects.toThrow("Task visit link insert failed.");
  });
});
