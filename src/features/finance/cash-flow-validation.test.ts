import { describe, expect, it } from "vitest";

import { cashFlowFilterSchema } from "@/features/finance/cash-flow-validation";

describe("cash flow filters", () => {
  it("accepts one canonical reporting month", () => {
    expect(cashFlowFilterSchema.parse({ month: "2026-09" })).toEqual({
      month: "2026-09",
    });
  });

  it.each([
    {},
    { month: "2026-9" },
    { month: "2026-13" },
    { month: "2026-09", projectId: "unexpected" },
  ])("rejects an unsafe report filter: %j", (value) => {
    expect(() => cashFlowFilterSchema.parse(value)).toThrow();
  });
});
