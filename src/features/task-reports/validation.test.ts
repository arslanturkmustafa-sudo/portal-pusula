import { describe, expect, it } from "vitest";

import { taskReportFilterSchema } from "@/features/task-reports/validation";

const customerId = "10000000-0000-4000-8000-000000000001";

describe("task report filters", () => {
  it("accepts a bounded due-date range and defaults status", () => {
    expect(
      taskReportFilterSchema.parse({ customerId, from: "2026-01-01", to: "2026-12-31" }),
    ).toEqual({ customerId, from: "2026-01-01", status: "all", to: "2026-12-31" });
  });

  it("accepts the terminal cancelled status", () => {
    expect(taskReportFilterSchema.parse({ customerId, status: "cancelled" })).toEqual({
      customerId,
      status: "cancelled",
    });
  });

  it.each([
    { customerId: "not-a-uuid" },
    { customerId, from: "2026-02-30", to: "2026-03-01" },
    { customerId, from: "2026-03-01" },
    { customerId, from: "2026-04-01", to: "2026-03-01" },
    { customerId, from: "2025-01-01", to: "2026-01-03" },
    { customerId, secret: "unexpected" },
  ])("rejects an unsafe or incoherent filter: %j", (value) => {
    expect(() => taskReportFilterSchema.parse(value)).toThrow();
  });
});
