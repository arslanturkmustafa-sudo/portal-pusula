import { describe, expect, it } from "vitest";

import { cashFlowFilterSchema } from "@/features/finance/cash-flow-validation";

describe("cash flow filters", () => {
  it.each(["weekly", "monthly"] as const)(
    "accepts a canonical inclusive date range with %s breakdown",
    (granularity) => {
      expect(
        cashFlowFilterSchema.parse({
          from: "2026-01-01",
          granularity,
          to: "2026-12-31",
        }),
      ).toEqual({
        from: "2026-01-01",
        granularity,
        to: "2026-12-31",
      });
    },
  );

  it("accepts 366 inclusive days across a leap day", () => {
    expect(
      cashFlowFilterSchema.parse({
        from: "2028-01-01",
        granularity: "monthly",
        to: "2028-12-31",
      }),
    ).toMatchObject({
      from: "2028-01-01",
      to: "2028-12-31",
    });
  });

  it.each([
    {},
    { from: "2026-09-01", granularity: "daily", to: "2026-09-30" },
    { from: "2026-02-30", granularity: "weekly", to: "2026-03-01" },
    { from: "2026-09-30", granularity: "weekly", to: "2026-09-01" },
    { from: "2026-01-01", granularity: "monthly", to: "2027-01-02" },
    {
      from: "2026-09-01",
      granularity: "weekly",
      projectId: "unexpected",
      to: "2026-09-30",
    },
  ])("rejects an unsafe report filter: %j", (value) => {
    expect(() => cashFlowFilterSchema.parse(value)).toThrow();
  });
});
