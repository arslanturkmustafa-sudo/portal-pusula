// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readProjectFinanceLedger } from "@/features/finance/project-reporting-repository";

describe("project finance reporting repository", () => {
  it("reads project, accrual, collection and expense ledgers with bounded dates", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[
        {
          active_customer_count: "2",
          display_name: "Mühendis Kafası",
          id: "project-1",
          project_type: "consulting",
          short_code: "MUHENDIS_KAFASI",
          status: "active",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          entry_count: "1",
          net_amount: "60000.0000",
          outstanding_amount: "10000.0000",
          overdue_amount: "10000.0000",
          project_id: "project-1",
          total_amount: "60000.0000",
          vat_amount: "0.0000",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          collected_amount: "50000.0000",
          entry_count: "1",
          project_id: "project-1",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          entry_count: "1",
          net_amount: "13750.0000",
          project_id: null,
          total_amount: "16500.0000",
          vat_amount: "2750.0000",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          earned_amount: "25000.0000",
          entry_count: "1",
          outstanding_amount: "25000.0000",
          paid_amount: "0.0000",
          project_id: "project-1",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          entry_count: "1",
          expected_amount: "7000.0000",
          outstanding_amount: "4000.0000",
          overdue_amount: "4000.0000",
          project_id: "project-1",
          received_amount: "3000.0000",
        },
      ], []]);

    const result = await readProjectFinanceLedger(
      { execute } as unknown as PoolConnection,
      { monthStart: "2026-09-01", nextMonthStart: "2026-10-01" },
      "2026-09-20",
    );

    expect(result.projects[0]).toEqual(expect.objectContaining({
      activeCustomerCount: 2,
      id: "project-1",
    }));
    expect(result.receivables[0]?.outstandingAmount).toBe("10000.0000");
    expect(result.expenses[0]?.projectId).toBeNull();
    expect(result.commissions[0]?.earnedAmount).toBe("25000.0000");
    expect(result.contributions[0]?.expectedAmount).toBe("7000.0000");
    expect(execute).toHaveBeenCalledTimes(6);
    expect(execute.mock.calls[1]?.[1]).toEqual([
      "2026-09-20",
      "2026-09-01",
      "2026-10-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    expect(execute.mock.calls[2]?.[1]).toEqual(["2026-09-01", "2026-10-01"]);
    expect(execute.mock.calls[3]?.[1]).toEqual(["2026-09-01", "2026-10-01"]);
    expect(execute.mock.calls[4]?.[1]).toHaveLength(12);
    expect(execute.mock.calls[5]?.[1]).toEqual([
      "2026-09-01", "2026-10-01",
      "2026-09-01", "2026-10-01",
      "2026-09-01", "2026-10-01",
      "2026-09-01", "2026-10-01", "2026-09-20",
      "2026-09-01", "2026-10-01",
      "2026-09-01", "2026-10-01",
    ]);
  });
});
