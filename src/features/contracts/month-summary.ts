import Decimal from "decimal.js";

import type { MonthlyVisit } from "@/features/contracts/repository";

export type VisitMonthSummary = Readonly<{
  cancelledVisitCount: number;
  committedVisitCount: number;
  completedVisitCount: number;
  completionRatio: string | null;
  makeupPendingVisitCount: number;
  planMissing: boolean;
  unresolvedVisitCount: number;
}>;

export function summarizeVisitMonth(
  visits: readonly Pick<MonthlyVisit, "resolutionStatus">[],
): VisitMonthSummary {
  const completedVisitCount = visits.filter(
    (visit) => visit.resolutionStatus === "completed",
  ).length;
  const makeupPendingVisitCount = visits.filter(
    (visit) => visit.resolutionStatus === "makeup_pending",
  ).length;
  const cancelledVisitCount = visits.filter(
    (visit) => visit.resolutionStatus === "cancelled_by_agreement",
  ).length;
  const committedVisitCount = visits.length;

  return {
    cancelledVisitCount,
    committedVisitCount,
    completedVisitCount,
    completionRatio:
      committedVisitCount === 0
        ? null
        : new Decimal(completedVisitCount)
            .dividedBy(committedVisitCount)
            .toFixed(4),
    makeupPendingVisitCount,
    planMissing: committedVisitCount === 0,
    unresolvedVisitCount:
      committedVisitCount - completedVisitCount - cancelledVisitCount,
  };
}
