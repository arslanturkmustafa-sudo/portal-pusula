// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateVatSourceSnapshot,
  listTaxCashFlowRecords,
  listTaxObligationRecords,
} from "./tax-repository";

describe("tax repository", () => {
  it("calculates VAT only from period-bound active operational sources", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [{ amount: "200.0000", source_count: 3 }],
        [],
      ])
      .mockResolvedValueOnce([
        [{ amount: "80.0000", source_count: 2 }],
        [],
      ]);
    await expect(
      calculateVatSourceSnapshot(
        { execute } as unknown as PoolConnection,
        "2026-08",
      ),
    ).resolves.toEqual({
      sourceExpenseCount: 2,
      sourceReceivableCount: 3,
      systemInputVatAmount: "80.0000",
      systemOutputVatAmount: "200.0000",
    });
    expect(execute.mock.calls[0]?.[0]).toContain(
      "source_type = BINARY 'contract_month'",
    );
    expect(execute.mock.calls[0]?.[0]).toContain("record_state = BINARY 'active'");
    expect(execute.mock.calls[1]?.[0]).toContain("status = BINARY 'active'");
    expect(execute.mock.calls[1]?.[1]).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("offers cash-flow only positive, non-voided obligations by due date", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await listTaxCashFlowRecords(
      { execute } as unknown as PoolConnection,
      "2026-09-01",
      "2026-09-30",
    );
    expect(execute.mock.calls[0]?.[0]).toContain(
      "status IN (BINARY 'planned', BINARY 'paid')",
    );
    expect(execute.mock.calls[0]?.[0]).toContain("payable_amount > 0");
    expect(execute.mock.calls[0]?.[0]).toContain("due_on >= ?");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      "2026-09-01",
      "2026-09-30",
    ]);
  });

  it("limits the tax workspace records to its selected period", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await listTaxObligationRecords(
      { execute } as unknown as PoolConnection,
      "2026-08",
    );
    expect(execute.mock.calls[0]?.[0]).toContain("WHERE period_month = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual(["2026-08-01"]);
  });
});
