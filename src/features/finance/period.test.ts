import { describe, expect, it } from "vitest";

import {
  dueDateForMonth,
  istanbulDate,
  monthIntersectsPeriod,
} from "@/features/finance/period";

describe("receivable period rules", () => {
  it("caps payment day to the real final day of the month", () => {
    expect(dueDateForMonth("2026-02", 31)).toBe("2026-02-28");
    expect(dueDateForMonth("2028-02", 31)).toBe("2028-02-29");
    expect(dueDateForMonth("2026-09", 5)).toBe("2026-09-05");
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
