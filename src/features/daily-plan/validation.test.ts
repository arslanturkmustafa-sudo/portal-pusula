import { describe, expect, it } from "vitest";

import {
  dailyPlanDateSchema,
  dailyPlanQuerySchema,
  dailyPlanViewSchema,
} from "@/features/daily-plan/validation";

describe("daily plan validation", () => {
  it("accepts only real canonical ISO dates", () => {
    expect(dailyPlanDateSchema.parse("2028-02-29")).toBe("2028-02-29");

    for (const value of [
      "0999-12-31",
      "2026-2-01",
      "2026-02-30",
      "2026-13-01",
      "",
    ]) {
      expect(dailyPlanDateSchema.safeParse(value).success, value).toBe(false);
    }
    expect(dailyPlanDateSchema.parse("1000-01-01")).toBe("1000-01-01");
  });

  it("accepts the supported views and defaults to a daily view", () => {
    expect(dailyPlanViewSchema.options).toEqual(["day", "week", "month"]);
    expect(dailyPlanQuerySchema.parse({ date: "2026-09-02" })).toEqual({
      date: "2026-09-02",
      view: "day",
    });
    expect(
      dailyPlanQuerySchema.parse({ date: "2026-09-02", view: "week" }),
    ).toEqual({ date: "2026-09-02", view: "week" });
  });

  it("requires the exact supported query shape", () => {
    expect(dailyPlanQuerySchema.safeParse({ date: null }).success).toBe(false);
    expect(
      dailyPlanQuerySchema.safeParse({ date: "2026-09-02", view: "year" })
        .success,
    ).toBe(false);
    expect(
      dailyPlanQuerySchema.safeParse({ date: "2026-09-02", extra: "value" })
        .success,
    ).toBe(false);
  });
});
