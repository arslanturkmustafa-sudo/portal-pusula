// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listReceivableCollectionMovements,
  listReceivableRecords,
} from "@/features/finance/repository";

describe("finance repository snapshot", () => {
  it("reads ledger rows and the in-range collection total in one SQL statement", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          collected_amount: "25.0000",
          collected_in_range_amount: "25.0000",
          contract_id: null,
          created_at_utc: "2026-09-01 09:00:00.000000",
          currency: "TRY",
          customer_id: "10000000-0000-4000-8000-000000000001",
          customer_name: "Test Müşterisi",
          description: "Devreden alacak",
          due_on: "2026-09-15",
          id: "30000000-0000-4000-8000-000000000001",
          net_amount: "100.0000",
          period_month: null,
          project_id: "70000000-0000-4000-8000-000000000001",
          project_name: "Mühendis Kafası",
          project_short_code: "MUHENDIS_KAFASI",
          record_state: "active",
          source_type: "opening_balance",
          total_amount: "100.0000",
          updated_at_utc: "2026-09-01 09:00:00.000000",
          vat_amount: "0.0000",
          version: 1,
          void_reason: null,
          voided_at_utc: null,
        },
      ],
      [],
    ]);

    const result = await listReceivableRecords(
      { execute } as unknown as PoolConnection,
      "2026-09-01",
      "2026-10-01",
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("CROSS JOIN"),
      ["2026-09-01", "2026-10-01"],
    );
    expect(String(execute.mock.calls[0]?.[0])).toMatch(
      /entry_type = 'reversal' THEN -rc\.amount/iu,
    );
    expect(result).toMatchObject({
      collectedAmountInRange: "25.0000",
      receivables: [
        {
          collectedAmount: "25.0000",
          projectName: "Mühendis Kafası",
        },
      ],
    });
  });

  it("applies the project filter to both ledger rows and in-range collections", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const projectId = "70000000-0000-4000-8000-000000000001";

    await listReceivableRecords(
      { execute } as unknown as PoolConnection,
      "2026-09-01",
      "2026-10-01",
      projectId,
    );

    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /collected_r\.project_id = \?[\s\S]*WHERE r\.project_id = \?/u,
      ),
      ["2026-09-01", "2026-10-01", projectId, projectId],
    );
  });

  it("returns a minimal collection movement model with reversal state and redacted reason", async () => {
    const projectId = "70000000-0000-4000-8000-000000000001";
    const originalId = "50000000-0000-4000-8000-000000000001";
    const execute = vi.fn().mockResolvedValue([
      [
        {
          amount: "25.0000",
          collected_on: "2026-09-01",
          entry_type: "collection",
          finance_transaction_id: "b0000000-0000-4000-8000-000000000001",
          id: originalId,
          reason_summary: null,
          receivable_id: "30000000-0000-4000-8000-000000000001",
          reversal_of_id: null,
          reversed_flag: 1,
          target_account_id: "60000000-0000-4000-8000-000000000001",
          target_account_name: "Ana TL Hesabı",
        },
        {
          amount: "25.0000",
          collected_on: "2026-09-02",
          entry_type: "reversal",
          finance_transaction_id: "c0000000-0000-4000-8000-000000000001",
          id: "50000000-0000-4000-8000-000000000002",
          reason_summary: "Ters kayıt gerekçesi kaydedildi.",
          receivable_id: "30000000-0000-4000-8000-000000000001",
          reversal_of_id: originalId,
          reversed_flag: "0",
          target_account_id: "60000000-0000-4000-8000-000000000001",
          target_account_name: "Ana TL Hesabı",
        },
      ],
      [],
    ]);

    const result = await listReceivableCollectionMovements(
      { execute } as unknown as PoolConnection,
      projectId,
    );

    expect(result).toEqual([
      expect.objectContaining({
        entryType: "collection",
        hasAccountMovement: true,
        reasonSummary: null,
        reversed: true,
        targetAccountName: "Ana TL Hesabı",
      }),
      expect.objectContaining({
        entryType: "reversal",
        reasonSummary: "Ters kayıt gerekçesi kaydedildi.",
        reversalOfId: originalId,
        reversed: false,
      }),
    ]);
    expect(result[1]).not.toHaveProperty("clientOperationKey");
    expect(result[1]).not.toHaveProperty("note");
    expect(result[1]).not.toHaveProperty("reversalReason");
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/EXISTS[\s\S]*END AS reason_summary/iu),
      [projectId],
    );
  });
});
