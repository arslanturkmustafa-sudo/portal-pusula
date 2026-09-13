// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listOpenFinanceDigestItems } from "./finance-digest-repository";

describe("finance digest repository", () => {
  it("reads only open items due by the business date without the cash-flow report", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            direction: "inflow",
            due_on: "2026-09-12",
            label: "Danışmanlık alacağı",
            remaining_amount: "1500.25",
            source_label: "Atlas",
          },
          {
            direction: "outflow",
            due_on: "2026-09-13",
            label: "KDV",
            remaining_amount: "800",
            source_label: "2026-08",
          },
        ],
      ])
      .mockResolvedValueOnce([[]]);
    const connection = { execute } as unknown as PoolConnection;

    await expect(
      listOpenFinanceDigestItems(connection, "2026-09-13"),
    ).resolves.toEqual([
      {
        direction: "inflow",
        dueOn: "2026-09-12",
        label: "Danışmanlık alacağı",
        remainingAmount: "1500.2500",
        sourceLabel: "Atlas",
      },
      {
        direction: "outflow",
        dueOn: "2026-09-13",
        label: "KDV",
        remainingAmount: "800.0000",
        sourceLabel: "2026-08",
      },
    ]);

    const dueSql = String(execute.mock.calls[0]?.[0]);
    expect(dueSql).toContain("receivable.due_on <= ?");
    expect(dueSql).toContain("installment.status = 'planned'");
    expect(dueSql).toContain("tax.status = BINARY 'planned'");
    expect(dueSql).not.toContain("finance_ledger_entry");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      "2026-09-13",
      "2026-09-13",
      "2026-09-13",
      "2026-09-13",
      "2026-09-13",
    ]);
  });
});
