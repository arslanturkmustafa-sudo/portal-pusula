// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listDailyAgendaItems } from "@/features/daily-plan/repository";

describe("daily agenda repository", () => {
  it("joins visits to every contract and customer for the exact local date", async () => {
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
      "2026-09-02",
    );

    expect(execute).toHaveBeenCalledOnce();
    const [sql, parameters] = execute.mock.calls[0] as [string, string[]];
    expect(sql).toContain("FROM monthly_visit_commitment AS visit");
    expect(sql).toContain("INNER JOIN consulting_contract AS contract");
    expect(sql).toContain("INNER JOIN customer");
    expect(sql).toContain("WHERE visit.committed_on = ?");
    expect(sql).toMatch(
      /ORDER BY visit\.internal_planned_at_utc IS NULL ASC,[\s\S]*visit\.internal_planned_at_utc ASC,[\s\S]*visit\.id ASC/u,
    );
    expect(sql).not.toMatch(/contract\.status\s*=/iu);
    expect(parameters).toEqual(["2026-09-02"]);
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
      ),
    ).rejects.toThrow("Visit resolution status is invalid.");
  });
});
