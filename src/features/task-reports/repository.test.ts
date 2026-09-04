// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findTaskReportCustomer,
  listTaskReportItems,
} from "@/features/task-reports/repository";

const customerId = "10000000-0000-4000-8000-000000000001";

describe("task report repository", () => {
  it("uses prepared customer identity and a finance-free bounded task projection", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[
        { display_name: "Öncü Üretim", id: customerId, short_code: "ONCU", status: "active" },
      ], []])
      .mockResolvedValueOnce([[
        {
          assignee_display_name: "Ayşe Yılmaz",
          completed_at_utc: null,
          description: "Hat iyileştirme adımlarını doğrula",
          due_on: "2026-09-08",
          id: "20000000-0000-4000-8000-000000000001",
          priority: "high",
          project_code: "YALIN",
          project_name: "Yalın dönüşüm",
          status: "in_progress",
          title: "Saha aksiyonlarını kapat",
        },
      ], []]);
    const connection = { execute } as unknown as PoolConnection;

    await expect(findTaskReportCustomer(connection, customerId)).resolves.toMatchObject({
      displayName: "Öncü Üretim",
    });
    await expect(
      listTaskReportItems(connection, {
        customerId,
        from: "2026-09-01",
        status: "open",
        to: "2026-09-30",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ assigneeDisplayName: "Ayşe Yılmaz", status: "in_progress" }),
    ]);

    const customerCall = execute.mock.calls[0];
    const taskCall = execute.mock.calls[1];
    expect(customerCall?.[0]).toMatch(/WHERE id = \?/u);
    expect(customerCall?.[1]).toEqual([customerId]);
    expect(taskCall?.[0]).toMatch(/task\.customer_id = \?[\s\S]*task\.due_on >= \?[\s\S]*task\.due_on <= \?[\s\S]*LIMIT 1001/u);
    expect(taskCall?.[1]).toEqual([customerId, "2026-09-01", "2026-09-30"]);
    expect(taskCall?.[0]).not.toMatch(/monthly_fee|consulting_contract|receivable|collection|expense|vat_/iu);
  });
});
