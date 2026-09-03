// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeProjectFinanceReport } from "@/features/finance/project-reporting-service";

describe("project finance report composition", () => {
  it("keeps unassigned records visible and includes them in portfolio totals", () => {
    const report = composeProjectFinanceReport(
      {
        commissions: [
          {
            earnedAmount: "25000.0000",
            entryCount: 1,
            outstandingAmount: "25000.0000",
            paidAmount: "0.0000",
            projectId: "project-1",
          },
        ],
        collections: [
          { collectedAmount: "50000.0000", entryCount: 1, projectId: "project-1" },
        ],
        contributions: [
          {
            entryCount: 1,
            expectedAmount: "7000.0000",
            outstandingAmount: "4000.0000",
            overdueAmount: "4000.0000",
            projectId: "project-1",
            receivedAmount: "3000.0000",
          },
        ],
        expenses: [
          {
            entryCount: 1,
            netAmount: "10000.0000",
            projectId: "project-1",
            totalAmount: "12000.0000",
            vatAmount: "2000.0000",
          },
          {
            entryCount: 1,
            netAmount: "5000.0000",
            projectId: null,
            totalAmount: "5000.0000",
            vatAmount: "0.0000",
          },
        ],
        projects: [
          {
            activeCustomerCount: 2,
            displayName: "Mühendis Kafası",
            id: "project-1",
            projectType: "consulting",
            shortCode: "MUHENDIS_KAFASI",
            status: "active",
          },
        ],
        receivables: [
          {
            entryCount: 1,
            netAmount: "60000.0000",
            outstandingAmount: "10000.0000",
            overdueAmount: "0.0000",
            projectId: "project-1",
            totalAmount: "60000.0000",
            vatAmount: "0.0000",
          },
        ],
      },
      "2026-09",
      "2026-09-03",
    );

    expect(report.projects[0]).toEqual(expect.objectContaining({
      partnerContributionExpectedAmount: "7000.0000",
      partnershipEarnedAmount: "25000.0000",
      preTaxOperatingDifference: "82000.0000",
      outstandingAmount: "39000.0000",
      overdueAmount: "4000.0000",
    }));
    expect(report.unassigned.expenseNetAmount).toBe("5000.0000");
    expect(report.portfolio.expenseNetAmount).toBe("15000.0000");
    expect(report.portfolio.preTaxOperatingDifference).toBe("77000.0000");
  });
});
