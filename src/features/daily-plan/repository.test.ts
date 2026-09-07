// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listDailyAgendaItems,
  listDailyPlanTasks,
} from "@/features/daily-plan/repository";

describe("daily agenda repository", () => {
  it("joins visits to every contract and customer inside the inclusive date range", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          committed_on: new Date("2026-09-02T00:00:00.000Z"),
          contract_id: "20000000-0000-4000-8000-000000000001",
          customer_code: "ONCU",
          customer_id: "10000000-0000-4000-8000-000000000001",
          customer_name: "Öncü Üretim",
          internal_duration_minutes: 120,
          internal_planned_at_utc: new Date("2026-09-02T06:00:00.000Z"),
          resolution_status: "planned",
          visit_id: "30000000-0000-4000-8000-000000000001",
        },
        {
          committed_on: "2026-09-02",
          contract_id: "20000000-0000-4000-8000-000000000002",
          customer_code: "ROTA",
          customer_id: "10000000-0000-4000-8000-000000000002",
          customer_name: "Rota Teknoloji",
          internal_duration_minutes: null,
          internal_planned_at_utc: null,
          resolution_status: "makeup_pending",
          visit_id: "30000000-0000-4000-8000-000000000002",
        },
      ],
      [],
    ]);

    const result = await listDailyAgendaItems(
      { execute } as unknown as PoolConnection,
      "2026-09-01",
      "2026-09-07",
    );

    expect(execute).toHaveBeenCalledOnce();
    const [sql, parameters] = execute.mock.calls[0] as [string, string[]];
    expect(sql).toContain("FROM monthly_visit_commitment AS visit");
    expect(sql).toContain("INNER JOIN consulting_contract AS contract");
    expect(sql).toContain("INNER JOIN customer");
    expect(sql).toContain("WHERE visit.committed_on BETWEEN ? AND ?");
    expect(sql).toMatch(
      /ORDER BY visit\.committed_on ASC,[\s\S]*visit\.internal_planned_at_utc IS NULL ASC,[\s\S]*visit\.internal_planned_at_utc ASC,[\s\S]*visit\.id ASC/u,
    );
    expect(sql).not.toMatch(/contract\.status\s*=/iu);
    expect(parameters).toEqual(["2026-09-01", "2026-09-07"]);
    expect(result).toEqual([
      {
        committedOn: "2026-09-02",
        contractId: "20000000-0000-4000-8000-000000000001",
        customerCode: "ONCU",
        customerId: "10000000-0000-4000-8000-000000000001",
        customerName: "Öncü Üretim",
        internalDurationMinutes: 120,
        internalPlannedAtUtc: "2026-09-02 06:00:00.000000",
        resolutionStatus: "planned",
        visitId: "30000000-0000-4000-8000-000000000001",
      },
      {
        committedOn: "2026-09-02",
        contractId: "20000000-0000-4000-8000-000000000002",
        customerCode: "ROTA",
        customerId: "10000000-0000-4000-8000-000000000002",
        customerName: "Rota Teknoloji",
        internalDurationMinutes: null,
        internalPlannedAtUtc: null,
        resolutionStatus: "makeup_pending",
        visitId: "30000000-0000-4000-8000-000000000002",
      },
    ]);
  });

  it("maps a customer task to the latest planned visit on or before its due date", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          calendar_on: new Date("2026-09-04T00:00:00.000Z"),
          calendar_source: "visit",
          customer_name: "Öncü Üretim",
          due_on: "2026-09-08",
          id: "40000000-0000-4000-8000-000000000001",
          linked_visit_id: "30000000-0000-4000-8000-000000000001",
          project_name: "Dönüşüm Programı",
          status: "todo",
          title: "Saha gözlemlerini hazırla",
        },
        {
          calendar_on: "2026-09-06",
          calendar_source: "due_date",
          customer_name: null,
          due_on: new Date("2026-09-06T00:00:00.000Z"),
          id: "40000000-0000-4000-8000-000000000002",
          linked_visit_id: null,
          project_name: null,
          status: "blocked",
          title: "İç kontrol listesini tamamla",
        },
      ],
      [],
    ]);

    const result = await listDailyPlanTasks(
      { execute } as unknown as PoolConnection,
      "2026-09-01",
      "2026-09-07",
    );

    expect(execute).toHaveBeenCalledOnce();
    const [sql, parameters] = execute.mock.calls[0] as [string, string[]];
    expect(sql).toContain("FROM work_task AS task");
    expect(sql).toContain("candidate_contract.customer_id = task.customer_id");
    expect(sql).toContain("candidate_visit.resolution_status = 'planned'");
    expect(sql).toContain("candidate_visit.committed_on <= task.due_on");
    expect(sql).toMatch(
      /ORDER BY candidate_visit\.committed_on DESC,[\s\S]*LIMIT 1/u,
    );
    expect(sql).toContain("LEFT JOIN work_task_visit AS exact_visit_link");
    expect(sql).toContain("exact_visit.id = exact_visit_link.visit_id");
    expect(sql).toMatch(
      /COALESCE\(\s*exact_visit\.committed_on,\s*mapped_visit\.committed_on,\s*task\.due_on\s*\) BETWEEN \? AND \?/u,
    );
    expect(sql).toContain(
      "task.status IN ('backlog', 'todo', 'in_progress', 'blocked')",
    );
    expect(sql).toContain(
      "task.status = 'done' AND exact_visit_link.task_id IS NOT NULL",
    );
    expect(sql).not.toContain("'cancelled'");
    expect(parameters).toEqual(["2026-09-01", "2026-09-07"]);
    expect(result).toEqual([
      {
        calendarOn: "2026-09-04",
        calendarSource: "visit",
        customerName: "Öncü Üretim",
        dueOn: "2026-09-08",
        id: "40000000-0000-4000-8000-000000000001",
        linkedVisitId: "30000000-0000-4000-8000-000000000001",
        projectName: "Dönüşüm Programı",
        status: "todo",
        title: "Saha gözlemlerini hazırla",
      },
      {
        calendarOn: "2026-09-06",
        calendarSource: "due_date",
        customerName: null,
        dueOn: "2026-09-06",
        id: "40000000-0000-4000-8000-000000000002",
        linkedVisitId: null,
        projectName: null,
        status: "blocked",
        title: "İç kontrol listesini tamamla",
      },
    ]);
  });

  it("accepts a completed work item on its exact linked visit", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          calendar_on: "2026-09-04",
          calendar_source: "visit",
          customer_name: "Öncü Üretim",
          due_on: "2026-09-05",
          id: "40000000-0000-4000-8000-000000000003",
          linked_visit_id: "30000000-0000-4000-8000-000000000003",
          project_name: "Dönüşüm Programı",
          status: "done",
          title: "Ziyaret riskleri paylaşıldı",
        },
      ],
      [],
    ]);

    await expect(
      listDailyPlanTasks(
        { execute } as unknown as PoolConnection,
        "2026-09-01",
        "2026-09-07",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        calendarOn: "2026-09-04",
        calendarSource: "visit",
        linkedVisitId: "30000000-0000-4000-8000-000000000003",
        status: "done",
      }),
    ]);
  });

  it.each([
    ["unknown", "due_date", null, "Task status is invalid."],
    [
      "todo",
      "unexpected",
      null,
      "Task calendar source is invalid.",
    ],
    [
      "todo",
      "visit",
      null,
      "Task calendar visit projection is invalid.",
    ],
    [
      "todo",
      "due_date",
      "30000000-0000-4000-8000-000000000001",
      "Task calendar visit projection is invalid.",
    ],
  ] as const)(
    "fails closed on an invalid persisted task calendar projection (%s, %s)",
    async (status, calendarSource, linkedVisitId, message) => {
      const execute = vi.fn().mockResolvedValue([
        [
          {
            calendar_on: "2026-09-06",
            calendar_source: calendarSource,
            customer_name: null,
            due_on: "2026-09-06",
            id: "40000000-0000-4000-8000-000000000002",
            linked_visit_id: linkedVisitId,
            project_name: null,
            status,
            title: "İç kontrol listesini tamamla",
          },
        ],
        [],
      ]);

      await expect(
        listDailyPlanTasks(
          { execute } as unknown as PoolConnection,
          "2026-09-01",
          "2026-09-07",
        ),
      ).rejects.toThrow(message);
    },
  );

  it("fails closed on an unknown persisted visit status", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          committed_on: "2026-09-02",
          contract_id: "20000000-0000-4000-8000-000000000001",
          customer_code: "TEST",
          customer_id: "10000000-0000-4000-8000-000000000001",
          customer_name: "Test",
          internal_duration_minutes: null,
          internal_planned_at_utc: null,
          resolution_status: "unexpected",
          visit_id: "30000000-0000-4000-8000-000000000001",
        },
      ],
      [],
    ]);

    await expect(
      listDailyAgendaItems(
        { execute } as unknown as PoolConnection,
        "2026-09-02",
        "2026-09-02",
      ),
    ).rejects.toThrow("Visit resolution status is invalid.");
  });
});
