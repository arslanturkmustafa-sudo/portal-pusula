// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listCardInstallmentRecords,
  listCardInstallmentsForBulkUpdate,
} from "@/features/finance/spending-repository";

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
    expect(execute.mock.calls[0]?.[0]).not.toContain("ci.status = 'planned'");
  });

  it("returns only stored-open rows for an all-period open-debt view", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);

    await listCardInstallmentRecords(
      { execute } as unknown as PoolConnection,
      { status: "open" },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("ci.status = 'planned'"),
      [],
    );
    expect(execute.mock.calls[0]?.[0]).not.toContain("ci.due_on >= ?");
  });

  it("locks one card period in deterministic due-date and identity order", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const cardId = "20000000-0000-4000-8000-000000000001";

    await listCardInstallmentsForBulkUpdate(
      { execute } as unknown as PoolConnection,
      cardId,
      "2026-09",
    );

    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /e\.credit_card_id = \?[\s\S]*ci\.due_on >= \?[\s\S]*ci\.due_on < \?[\s\S]*ORDER BY ci\.due_on ASC, ci\.id ASC[\s\S]*FOR UPDATE/u,
      ),
      [cardId, "2026-09-01", "2026-10-01"],
    );
  });
});
