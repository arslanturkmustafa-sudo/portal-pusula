// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listCardInstallmentRecords } from "@/features/finance/spending-repository";

describe("spending repository payment-plan filters", () => {
  it("filters a monthly payment plan by due date rather than statement month", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);

    await listCardInstallmentRecords(
      { execute } as unknown as PoolConnection,
      { month: "2026-10" },
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("ci.due_on >= ?"),
      ["2026-10-01", "2026-11-01"],
    );
    expect(execute.mock.calls[0]?.[0]).not.toContain("ci.statement_month = ?");
  });
});
