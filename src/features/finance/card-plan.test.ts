import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  buildCardInstallmentPlan,
  dueDateForStatement,
  statementMonthForPurchase,
} from "@/features/finance/card-plan";

describe("credit-card installment plan", () => {
  it("places purchases after closing into the next statement", () => {
    expect(statementMonthForPurchase("2026-09-25", 25)).toBe("2026-09");
    expect(statementMonthForPurchase("2026-09-26", 25)).toBe("2026-10");
    expect(statementMonthForPurchase("2027-02-28", 31)).toBe("2027-02");
  });

  it("moves a due day at or before closing into the following month", () => {
    expect(dueDateForStatement("2026-09", 25, 5)).toBe("2026-10-05");
    expect(dueDateForStatement("2027-02", 10, 31)).toBe("2027-02-28");
  });

  it("preserves the exact total and places the remainder on the last installment", () => {
    const plan = buildCardInstallmentPlan({
      incurredOn: "2026-09-26",
      installmentCount: 3,
      paymentDueDay: 5,
      statementClosingDay: 25,
      totalAmount: "100.0000",
    });
    expect(plan.map((item) => item.amount)).toEqual([
      "33.3333",
      "33.3333",
      "33.3334",
    ]);
    expect(
      plan.reduce((sum, item) => sum.plus(item.amount), new Decimal(0)).toFixed(4),
    ).toBe("100.0000");
    expect(plan.map((item) => item.statementMonth)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(plan.map((item) => item.dueOn)).toEqual([
      "2026-11-05",
      "2026-12-05",
      "2027-01-05",
    ]);
  });
});
