import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectFinanceWorkspace } from "@/components/home/project-finance-workspace";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectFinanceWorkspace", () => {
  it("shows project attribution and warns about unassigned records", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse({
      generatedOn: "2026-09-03",
      month: "2026-09",
      portfolio: {
        accruedNetAmount: "60000.0000",
        accruedTotalAmount: "60000.0000",
        accruedVatAmount: "0.0000",
        collectedAmount: "50000.0000",
        collectionCount: 1,
        commissionCount: 1,
        contributionCount: 1,
        expenseCount: 1,
        expenseNetAmount: "5000.0000",
        expenseTotalAmount: "5000.0000",
        expenseVatAmount: "0.0000",
        outstandingAmount: "10000.0000",
        overdueAmount: "0.0000",
        partnerContributionExpectedAmount: "7000.0000",
        partnerContributionReceivedAmount: "3000.0000",
        partnershipEarnedAmount: "25000.0000",
        partnershipPaidAmount: "0.0000",
        preTaxOperatingDifference: "55000.0000",
        receivableCount: 1,
      },
      projects: [{
        activeCustomerCount: 1,
        accruedNetAmount: "60000.0000",
        accruedTotalAmount: "60000.0000",
        accruedVatAmount: "0.0000",
        collectedAmount: "50000.0000",
        collectionCount: 1,
        commissionCount: 1,
        contributionCount: 1,
        displayName: "Mühendis Kafası",
        expenseCount: 0,
        expenseNetAmount: "0.0000",
        expenseTotalAmount: "0.0000",
        expenseVatAmount: "0.0000",
        id: "project-1",
        outstandingAmount: "10000.0000",
        overdueAmount: "0.0000",
        partnerContributionExpectedAmount: "7000.0000",
        partnerContributionReceivedAmount: "3000.0000",
        partnershipEarnedAmount: "25000.0000",
        partnershipPaidAmount: "0.0000",
        preTaxOperatingDifference: "60000.0000",
        projectType: "consulting",
        receivableCount: 1,
        shortCode: "MUHENDIS_KAFASI",
        status: "active",
      }],
      unassigned: {
        accruedNetAmount: "0.0000",
        accruedTotalAmount: "0.0000",
        accruedVatAmount: "0.0000",
        collectedAmount: "0.0000",
        collectionCount: 0,
        commissionCount: 0,
        contributionCount: 0,
        expenseCount: 1,
        expenseNetAmount: "5000.0000",
        expenseTotalAmount: "5000.0000",
        expenseVatAmount: "0.0000",
        outstandingAmount: "0.0000",
        overdueAmount: "0.0000",
        partnerContributionExpectedAmount: "0.0000",
        partnerContributionReceivedAmount: "0.0000",
        partnershipEarnedAmount: "0.0000",
        partnershipPaidAmount: "0.0000",
        preTaxOperatingDifference: "-5000.0000",
        receivableCount: 0,
      },
    })));

    render(<ProjectFinanceWorkspace />);

    expect(await screen.findByText("Mühendis Kafası")).toBeInTheDocument();
    expect(screen.getByText("Projesi belirlenmemiş finans kaydı var")).toBeInTheDocument();
    expect(screen.getByText("Proje geliri − gider net")).toBeInTheDocument();
    expect(screen.getAllByText("₺60.000").length).toBeGreaterThan(0);
  });
});
