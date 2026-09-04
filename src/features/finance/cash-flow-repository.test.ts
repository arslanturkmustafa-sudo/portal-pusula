// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readCashFlowLedger } from "@/features/finance/cash-flow-repository";

describe("cash flow repository", () => {
  it("projects each physical cash event once and keeps forecast separate", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            amount: "400.0000",
            direction: "inflow",
            entry_count: 1,
            kind: "customer_collection",
          },
          {
            amount: "600.0000",
            direction: "inflow",
            entry_count: "2",
            kind: "partner_contribution",
          },
          {
            amount: "600.0000",
            direction: "outflow",
            entry_count: 1,
            kind: "card_installment",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            amount: "600.0000",
            bucket: "scheduled",
            direction: "inflow",
            entry_count: 1,
            kind: "customer_receivable",
          },
          {
            amount: "600.0000",
            bucket: "scheduled",
            direction: "outflow",
            entry_count: 1,
            kind: "card_installment",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ amount: "50.0000", entry_count: 1 }], []]);

    await expect(
      readCashFlowLedger(
        { execute } as unknown as PoolConnection,
        { monthStart: "2026-09-01", nextMonthStart: "2026-10-01" },
        "2026-09-15",
      ),
    ).resolves.toEqual({
      actual: [
        {
          amount: "400.0000",
          direction: "inflow",
          entryCount: 1,
          kind: "customer_collection",
        },
        {
          amount: "600.0000",
          direction: "inflow",
          entryCount: 2,
          kind: "partner_contribution",
        },
        {
          amount: "600.0000",
          direction: "outflow",
          entryCount: 1,
          kind: "card_installment",
        },
      ],
      forecast: [
        {
          amount: "600.0000",
          bucket: "scheduled",
          direction: "inflow",
          entryCount: 1,
          kind: "customer_receivable",
        },
        {
          amount: "600.0000",
          bucket: "scheduled",
          direction: "outflow",
          entryCount: 1,
          kind: "card_installment",
        },
      ],
      unclassifiedExpenseAmount: "50.0000",
      unclassifiedExpenseCount: 1,
    });

    const actualSql = String(execute.mock.calls[0]?.[0]);
    expect(actualSql).toMatch(/receivable_collection[\s\S]*partnership_contribution_receipt/iu);
    expect(actualSql).toMatch(/partnership_commission[\s\S]*pc\.paid_on/iu);
    expect(actualSql).toMatch(/'card_installment'[\s\S]*cci\.amount[\s\S]*FROM credit_card_installment/iu);
    expect(actualSql).toContain("UNION ALL");
    expect(actualSql).toMatch(/rc\.entry_type = 'reversal'[\s\S]*'outflow'/iu);
    expect(actualSql).toMatch(/pcr\.entry_type = 'reversal'[\s\S]*'outflow'/iu);
    expect(execute.mock.calls[0]?.[1]).toHaveLength(15);

    const forecastSql = String(execute.mock.calls[1]?.[0]);
    expect(forecastSql).toMatch(/total_amount - COALESCE\(rc\.collected_amount/iu);
    expect(forecastSql).toMatch(/entry_type = 'reversal' THEN -amount/iu);
    expect(forecastSql).toContain("r.record_state = 'active'");
    expect(forecastSql).toMatch(/cci\.status = 'planned'/iu);
    expect(forecastSql).toMatch(/pc\.status = 'agency_collected'/iu);
    expect(execute.mock.calls[1]?.[1]).toHaveLength(12);
  });
});
