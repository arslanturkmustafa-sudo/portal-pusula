// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FinanceLedgerIntegrityError } from "@/features/finance/account-repository";
import {
  cashFlowPeriodBounds,
  composeCashFlowReport,
} from "@/features/finance/cash-flow-service";
import type { CashFlowLedgerSnapshot } from "@/features/finance/cash-flow-repository";

const snapshot: CashFlowLedgerSnapshot = {
  accountOpenings: [
    {
      accountCount: 1,
      amount: "250.0000",
      eventOn: "2026-09-14",
    },
  ],
  actual: [
    {
      entryCount: 1,
      eventOn: "2026-09-07",
      inflowAmount: "0.1000",
      outflowAmount: "0.0000",
    },
    {
      entryCount: 1,
      eventOn: "2026-09-08",
      inflowAmount: "0.2000",
      outflowAmount: "0.0000",
    },
    {
      entryCount: 1,
      eventOn: "2026-09-14",
      inflowAmount: "0.0000",
      outflowAmount: "50.0000",
    },
    {
      entryCount: 2,
      eventOn: "2026-09-20",
      inflowAmount: "100.0000",
      outflowAmount: "20.0000",
    },
  ],
  balance: {
    accountCount: 2,
    closingBalanceAmount: "1280.3000",
    currentAssetAmount: "1280.3000",
    openingBalanceAmount: "1000.0000",
  },
  dueItems: [
    {
      direction: "outflow",
      dueOn: "2026-08-30",
      id: "tax_payment:30000000-0000-4000-8000-000000000004",
      kind: "tax_payment",
      label: "Geçici vergi",
      remainingAmount: "20.0000",
      settledAmount: "0.0000",
      sourceLabel: "2026-07",
      status: "overdue",
      totalAmount: "20.0000",
    },
    {
      direction: "inflow",
      dueOn: "2026-09-10",
      id: "receivable:30000000-0000-4000-8000-000000000002",
      kind: "customer_receivable",
      label: "Eylül danışmanlık hizmeti",
      remainingAmount: "200.0000",
      settledAmount: "0.0000",
      sourceLabel: "Acme · Danışmanlık",
      status: "planned",
      totalAmount: "200.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-07",
      id: "other_expense:office:2026-09-07",
      kind: "other_expense",
      label: "Ofis · 1 kayıt",
      remainingAmount: "0.0000",
      settledAmount: "50.0000",
      sourceLabel: null,
      status: "actual",
      totalAmount: "50.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-09",
      id: "tax_payment:30000000-0000-4000-8000-000000000005",
      kind: "tax_payment",
      label: "KDV",
      remainingAmount: "0.0000",
      settledAmount: "30.0000",
      sourceLabel: "2026-08",
      status: "settled",
      totalAmount: "30.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-18",
      id: "tax_payment:30000000-0000-4000-8000-000000000006",
      kind: "tax_payment",
      label: "Gelir vergisi",
      remainingAmount: "40.0000",
      settledAmount: "0.0000",
      sourceLabel: "2026-08",
      status: "planned",
      totalAmount: "40.0000",
    },
    {
      direction: "inflow",
      dueOn: "2026-08-31",
      id: "receivable:30000000-0000-4000-8000-000000000003",
      kind: "customer_receivable",
      label: "Eski alacak",
      remainingAmount: "10.0000",
      settledAmount: "0.0000",
      sourceLabel: "Acme",
      status: "overdue",
      totalAmount: "10.0000",
    },
  ],
  forecast: [
    {
      amount: "200.0000",
      bucket: "scheduled",
      direction: "inflow",
      entryCount: 1,
      eventOn: "2026-09-10",
      kind: "customer_receivable",
    },
    {
      amount: "10.0000",
      bucket: "overdue",
      direction: "inflow",
      entryCount: 1,
      eventOn: "2026-08-31",
      kind: "customer_receivable",
    },
    {
      amount: "35.0000",
      bucket: "overdue",
      direction: "outflow",
      entryCount: 1,
      eventOn: "2026-09-15",
      kind: "card_installment",
    },
    {
      amount: "40.0000",
      bucket: "scheduled",
      direction: "outflow",
      entryCount: 1,
      eventOn: "2026-09-18",
      kind: "tax_payment",
    },
    {
      amount: "20.0000",
      bucket: "overdue",
      direction: "outflow",
      entryCount: 1,
      eventOn: "2026-08-30",
      kind: "tax_payment",
    },
    {
      amount: "12.0000",
      bucket: "undated",
      direction: "inflow",
      entryCount: 1,
      eventOn: null,
      kind: "commission_receivable",
    },
  ],
  unclassifiedExpenseAmount: "5.0000",
  unclassifiedExpenseCount: 1,
};

describe("cash flow report composition", () => {
  it("reconciles weekly period totals and rolling balances with decimal arithmetic", () => {
    const report = composeCashFlowReport(
      snapshot,
      { from: "2026-09-07", granularity: "weekly", to: "2026-09-20" },
      "2026-09-15",
    );

    expect(report.actual).toEqual({
      entryCount: 5,
      inflowAmount: "100.3000",
      netAmount: "30.3000",
      outflowAmount: "70.0000",
    });
    expect(report.balance).toEqual({
      accountOpeningAmount: "250.0000",
      accountCount: 2,
      asOfOn: "2026-09-15",
      closingBalanceAmount: "1280.3000",
      currentAssetAmount: "1280.3000",
      openingBalanceAmount: "1000.0000",
      status: "configured",
    });
    expect(report.periods).toHaveLength(2);
    expect(report.periods[0]).toMatchObject({
      accountOpeningAmount: "0.0000",
      actual: {
        inflowAmount: "0.3000",
        netAmount: "0.3000",
        outflowAmount: "0.0000",
      },
      closingBalanceAmount: "1000.3000",
      endOn: "2026-09-13",
      forecast: { scheduled: { netAmount: "200.0000" } },
      openingBalanceAmount: "1000.0000",
      startOn: "2026-09-07",
    });
    expect(report.periods[1]).toMatchObject({
      accountOpeningAmount: "250.0000",
      actual: {
        inflowAmount: "100.0000",
        netAmount: "30.0000",
        outflowAmount: "70.0000",
      },
      closingBalanceAmount: "1280.3000",
      endOn: "2026-09-20",
      forecast: { overdue: { netAmount: "-35.0000" } },
      openingBalanceAmount: "1000.3000",
      startOn: "2026-09-14",
    });
    expect(report.forecast.scheduled.netAmount).toBe("160.0000");
    expect(report.forecast.overdue.netAmount).toBe("-45.0000");
    expect(report.forecast.overdueInRange.netAmount).toBe("-35.0000");
    expect(report.periods[0]?.forecast.overdue.netAmount).toBe("0.0000");
    expect(report.periods[1]?.forecast.overdue.netAmount).toBe("-35.0000");
    expect(report.forecast.undatedInflowAmount).toBe("12.0000");
    expect(report.dueItems).toEqual([
      expect.objectContaining({
        dueOn: "2026-08-30",
        id: "tax_payment:30000000-0000-4000-8000-000000000004",
        kind: "tax_payment",
        remainingAmount: "20.0000",
        status: "overdue",
      }),
      expect.objectContaining({
        dueOn: "2026-08-31",
        id: "receivable:30000000-0000-4000-8000-000000000003",
        status: "overdue",
      }),
      expect.objectContaining({
        dueOn: "2026-09-07",
        id: "other_expense:office:2026-09-07",
        status: "actual",
      }),
      expect.objectContaining({
        dueOn: "2026-09-09",
        id: "tax_payment:30000000-0000-4000-8000-000000000005",
        kind: "tax_payment",
        remainingAmount: "0.0000",
        settledAmount: "30.0000",
        status: "settled",
      }),
      expect.objectContaining({
        dueOn: "2026-09-10",
        id: "receivable:30000000-0000-4000-8000-000000000002",
        status: "planned",
      }),
      expect.objectContaining({
        dueOn: "2026-09-18",
        id: "tax_payment:30000000-0000-4000-8000-000000000006",
        kind: "tax_payment",
        remainingAmount: "40.0000",
        settledAmount: "0.0000",
        status: "planned",
      }),
    ]);
  });

  it("clips monthly buckets to the selected inclusive range", () => {
    expect(
      cashFlowPeriodBounds({
        from: "2026-08-20",
        granularity: "monthly",
        to: "2026-10-10",
      }),
    ).toEqual([
      { endOn: "2026-08-31", startOn: "2026-08-20" },
      { endOn: "2026-09-30", startOn: "2026-09-01" },
      { endOn: "2026-10-10", startOn: "2026-10-01" },
    ]);
  });

  it("excludes scheduled cash events before a future report range", () => {
    const report = composeCashFlowReport(
      {
        accountOpenings: [],
        actual: [],
        balance: {
          accountCount: 1,
          closingBalanceAmount: "1000.0000",
          currentAssetAmount: "1000.0000",
          openingBalanceAmount: "1000.0000",
        },
        dueItems: [],
        forecast: [
          {
            amount: "100.0000",
            bucket: "scheduled",
            direction: "outflow",
            entryCount: 1,
            eventOn: "2026-09-18",
            kind: "direct_expense",
          },
          {
            amount: "20.0000",
            bucket: "scheduled",
            direction: "outflow",
            entryCount: 1,
            eventOn: "2026-09-25",
            kind: "direct_expense",
          },
        ],
        unclassifiedExpenseAmount: "0.0000",
        unclassifiedExpenseCount: 0,
      },
      { from: "2026-09-20", granularity: "weekly", to: "2026-09-30" },
      "2026-09-15",
    );

    expect(report.forecast.scheduled.outflowAmount).toBe("20.0000");
  });

  it("adds account opening balances only in the monthly period where the account was created", () => {
    const report = composeCashFlowReport(
      {
        accountOpenings: [
          { accountCount: 1, amount: "100.0000", eventOn: "2026-09-15" },
          { accountCount: 1, amount: "50.0000", eventOn: "2026-10-02" },
        ],
        actual: [],
        balance: {
          accountCount: 3,
          closingBalanceAmount: "650.0000",
          currentAssetAmount: "650.0000",
          openingBalanceAmount: "500.0000",
        },
        dueItems: [],
        forecast: [],
        unclassifiedExpenseAmount: "0.0000",
        unclassifiedExpenseCount: 0,
      },
      { from: "2026-09-01", granularity: "monthly", to: "2026-10-31" },
      "2026-10-31",
    );

    expect(report.periods).toMatchObject([
      {
        accountOpeningAmount: "100.0000",
        closingBalanceAmount: "600.0000",
        openingBalanceAmount: "500.0000",
      },
      {
        accountOpeningAmount: "50.0000",
        closingBalanceAmount: "650.0000",
        openingBalanceAmount: "600.0000",
      },
    ]);
  });

  it("terminates safely at the maximum supported date", () => {
    expect(
      cashFlowPeriodBounds({
        from: "9999-12-31",
        granularity: "weekly",
        to: "9999-12-31",
      }),
    ).toEqual([{ endOn: "9999-12-31", startOn: "9999-12-31" }]);
  });

  it("fails closed when closing does not equal opening, account openings and actual net", () => {
    expect(() =>
      composeCashFlowReport(
        {
          ...snapshot,
          balance: { ...snapshot.balance, closingBalanceAmount: "1280.3100" },
        },
        { from: "2026-09-07", granularity: "weekly", to: "2026-09-20" },
        "2026-09-15",
      ),
    ).toThrow(FinanceLedgerIntegrityError);
  });
});
