// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readCashFlowLedger } from "@/features/finance/cash-flow-repository";

describe("cash flow repository", () => {
  it("uses the reconciled account ledger for actual cash and keeps forecast separate", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [
          {
            account_count: 2,
            closing_balance_amount: "1325.2500",
            opening_balance_amount: "1000.0000",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            account_count: "1",
            amount: "250.0000",
            event_on: "2026-09-12",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            entry_count: "2",
            event_on: "2026-09-07",
            inflow_amount: "400.2500",
            outflow_amount: "75.0000",
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
            event_on: "2026-09-20",
            kind: "customer_receivable",
          },
          {
            amount: "35.0000",
            bucket: "undated",
            direction: "inflow",
            entry_count: "1",
            event_on: null,
            kind: "commission_receivable",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ amount: "50.0000", entry_count: 1 }], []]);

    await expect(
      readCashFlowLedger(
        { execute } as unknown as PoolConnection,
        { endOn: "2026-09-30", startOn: "2026-09-01" },
        "2026-09-15",
      ),
    ).resolves.toEqual({
      accountOpenings: [
        {
          accountCount: 1,
          amount: "250.0000",
          eventOn: "2026-09-12",
        },
      ],
      actual: [
        {
          entryCount: 2,
          eventOn: "2026-09-07",
          inflowAmount: "400.2500",
          outflowAmount: "75.0000",
        },
      ],
      balance: {
        accountCount: 2,
        closingBalanceAmount: "1325.2500",
        openingBalanceAmount: "1000.0000",
      },
      forecast: [
        {
          amount: "600.0000",
          bucket: "scheduled",
          direction: "inflow",
          entryCount: 1,
          eventOn: "2026-09-20",
          kind: "customer_receivable",
        },
        {
          amount: "35.0000",
          bucket: "undated",
          direction: "inflow",
          entryCount: 1,
          eventOn: null,
          kind: "commission_receivable",
        },
      ],
      unclassifiedExpenseAmount: "50.0000",
      unclassifiedExpenseCount: 1,
    });

    expect(execute).toHaveBeenCalledTimes(7);
    expect(String(execute.mock.calls[0]?.[0])).toContain("finance_transaction");

    const balanceSql = String(execute.mock.calls[2]?.[0]);
    expect(balanceSql).toMatch(/SUM\(a\.opening_balance_amount\)/u);
    expect(balanceSql).toMatch(
      /DATE\(CONVERT_TZ\(a\.created_at_utc, '\+00:00', '\+03:00'\)\) < \?/u,
    );
    expect(balanceSql).toMatch(
      /DATE\(CONVERT_TZ\(a\.created_at_utc, '\+00:00', '\+03:00'\)\) <= \?/u,
    );
    expect(balanceSql).toMatch(/t\.occurred_on < \?/u);
    expect(balanceSql).toMatch(/t\.occurred_on <= \?/u);
    expect(execute.mock.calls[2]?.[1]).toEqual([
      "2026-09-30",
      "2026-09-15",
      "2026-09-01",
      "2026-09-15",
      "2026-09-01",
      "2026-09-15",
      "2026-09-30",
      "2026-09-15",
      "2026-09-30",
      "2026-09-15",
    ]);

    const accountOpeningSql = String(execute.mock.calls[3]?.[0]);
    expect(accountOpeningSql).toMatch(
      /CONVERT_TZ\(a\.created_at_utc, '\+00:00', '\+03:00'\)/u,
    );
    expect(execute.mock.calls[3]?.[1]).toEqual([
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    const actualSql = String(execute.mock.calls[4]?.[0]);
    expect(actualSql).toMatch(/FROM finance_transaction t/u);
    expect(actualSql).toMatch(/JOIN finance_ledger_entry le/u);
    expect(actualSql).toMatch(/transaction_type = BINARY 'income'/u);
    expect(actualSql).toMatch(/transaction_type = BINARY 'expense'/u);
    expect(actualSql).not.toMatch(/transaction_type = BINARY 'transfer'[\s\S]*THEN le\.amount/u);
    expect(execute.mock.calls[4]?.[1]).toEqual([
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    const forecastSql = String(execute.mock.calls[5]?.[0]);
    expect(forecastSql).toMatch(/total_amount - COALESCE\(rc\.collected_amount/iu);
    expect(forecastSql).toContain("r.record_state = 'active'");
    expect(forecastSql).toMatch(/cci\.status = 'planned'/iu);
    expect(forecastSql).toMatch(/pc\.status = 'agency_collected'/iu);
    expect(forecastSql).toMatch(
      /r\.due_on < \? OR \(r\.due_on >= \? AND r\.due_on <= \?\)/u,
    );
    expect(forecastSql).toMatch(
      /pc\.due_on < \? OR \(pc\.due_on >= \? AND pc\.due_on <= \?\)/u,
    );
    expect(forecastSql).toMatch(
      /cci\.due_on < \? OR \(cci\.due_on >= \? AND cci\.due_on <= \?\)/u,
    );
    expect(execute.mock.calls[5]?.[1]).toEqual([
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);
  });
});
