import { describe, expect, it } from "vitest";

import { projectFinanceReportFilterSchema } from "@/features/finance/project-reporting-validation";

describe("project finance report filter", () => {
  it("accepts a real canonical month", () => {
    expect(projectFinanceReportFilterSchema.parse({ month: "2026-09" })).toEqual({
      month: "2026-09",
    });
  });

  it.each(["2026-00", "2026-13", "26-09", "2026-9"])(
    "rejects invalid month %s",
    (month) => {
      expect(projectFinanceReportFilterSchema.safeParse({ month }).success).toBe(false);
    },
  );
});
