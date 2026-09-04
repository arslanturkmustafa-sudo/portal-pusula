// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeCashFlowReport } from "@/features/finance/cash-flow-service";

describe("cash flow report composition", () => {
  it("uses decimal arithmetic and never invents an opening balance", () => {
    const report = composeCashFlowReport(
      {
        actual: [
          {
            amount: "0.1000",
            direction: "inflow",
            entryCount: 1,
            kind: "customer_collection",
          },
          {
            amount: "0.2000",
            direction: "inflow",
            entryCount: 1,
            kind: "partner_contribution",
          },
          {
            amount: "0.0500",
            direction: "outflow",
            entryCount: 1,
            kind: "card_installment",
          },
        ],
        forecast: [
          {
            amount: "100.0000",
            bucket: "scheduled",
            direction: "inflow",
            entryCount: 1,
            kind: "customer_receivable",
          },
          {
            amount: "35.0000",
            bucket: "overdue",
            direction: "outflow",
            entryCount: 1,
            kind: "card_installment",
          },
          {
            amount: "12.0000",
            bucket: "undated",
            direction: "inflow",
            entryCount: 1,
            kind: "commission_receivable",
          },
        ],
        unclassifiedExpenseAmount: "5.0000",
        unclassifiedExpenseCount: 1,
      },
      "2026-09",
      "2026-09-15",
    );

    expect(report.actual).toMatchObject({
      inflowAmount: "0.3000",
      netAmount: "0.2500",
      outflowAmount: "0.0500",
    });
    expect(report.forecast.scheduled.netAmount).toBe("100.0000");
    expect(report.forecast.overdue.netAmount).toBe("-35.0000");
    expect(report.forecast.undatedInflowAmount).toBe("12.0000");
    expect(report.balanceStatus).toBe("not_configured");
    expect(JSON.stringify(report)).not.toContain("openingAmount");
    expect(JSON.stringify(report)).not.toContain("closingAmount");
  });
});
