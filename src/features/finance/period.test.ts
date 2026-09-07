import { describe, expect, it } from "vitest";

import {
  dueDateForMonth,
  istanbulDate,
  monthIntersectsPeriod,
} from "@/features/finance/period";

describe("receivable period rules", () => {
  it("uses the payment day in the month after the service month", () => {
    expect(dueDateForMonth("2026-08", 5)).toBe("2026-09-05");
    expect(dueDateForMonth("2026-03", 31)).toBe("2026-04-30");
    expect(dueDateForMonth("2028-01", 31)).toBe("2028-02-29");
    expect(dueDateForMonth("2026-12", 5)).toBe("2027-01-05");
  });

  it("accepts only months intersecting the contract period", () => {
    expect(monthIntersectsPeriod("2026-09", "2026-09-15", "2027-08-31")).toBe(
      true,
    );
    expect(monthIntersectsPeriod("2026-08", "2026-09-15", "2027-08-31")).toBe(
      false,
    );
    expect(monthIntersectsPeriod("2027-09", "2026-09-15", "2027-08-31")).toBe(
      false,
    );
  });

  it("uses the Istanbul business date at UTC day boundaries", () => {
    expect(istanbulDate(new Date("2026-08-31T22:30:00.000Z"))).toBe(
      "2026-09-01",
    );
  });
});
