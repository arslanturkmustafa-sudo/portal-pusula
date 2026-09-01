import { describe, expect, it } from "vitest";

import { summarizeVisitMonth } from "@/features/contracts/month-summary";

describe("summarizeVisitMonth", () => {
  it("summarizes completed, makeup and mutually cancelled commitments", () => {
    const summary = summarizeVisitMonth([
      { resolutionStatus: "completed" },
      { resolutionStatus: "completed" },
      { resolutionStatus: "makeup_pending" },
      { resolutionStatus: "cancelled_by_agreement" },
    ]);

    expect(summary).toEqual({
      cancelledVisitCount: 1,
      committedVisitCount: 4,
      completedVisitCount: 2,
      completionRatio: "0.5000",
      makeupPendingVisitCount: 1,
      planMissing: false,
      unresolvedVisitCount: 1,
    });
  });

  it("marks an empty month as missing instead of zero performance", () => {
    expect(summarizeVisitMonth([])).toEqual({
      cancelledVisitCount: 0,
      committedVisitCount: 0,
      completedVisitCount: 0,
      completionRatio: null,
      makeupPendingVisitCount: 0,
      planMissing: true,
      unresolvedVisitCount: 0,
    });
  });
});
