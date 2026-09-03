// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  insertContributionRecordIdempotently,
  insertContributionReceiptIdempotently,
  listCommissionRecords,
  listContributionRecords,
} from "./repository";

const contributionRow = {
  client_operation_key: "30000000-0000-4000-8000-000000000001",
  contribution_month: "2026-09-01",
  created_at_utc: "2026-09-03 08:00:00.000000",
  description: "Ofis kirası ortak katkısı",
  due_on: "2026-09-15",
  expected_amount: "7000.0000",
  id: "40000000-0000-4000-8000-000000000001",
  note: null,
  project_id: "20000000-0000-4000-8000-000000000001",
  project_name: "7 Emlak Ajansı",
  project_short_code: "7EMLAK",
  received_amount: "0.0000",
  received_on: null,
  status: "expected",
  updated_at_utc: "2026-09-03 08:00:00.000000",
  version: 1,
};

describe("partnership finance repository", () => {
  it("bounds commission filters to the selected project month", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await listCommissionRecords({ execute } as unknown as PoolConnection, {
      month: "2026-12",
      projectId: contributionRow.project_id,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("pc.closed_on >= ?"),
      [contributionRow.project_id, "2026-12-01", "2027-01-01"],
    );
  });

  it("uses contribution month rather than receipt date for monthly reporting", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await listContributionRecords({ execute } as unknown as PoolConnection, { month: "2026-09" });
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("pc.contribution_month >= ?");
    expect(sql).not.toContain("pc.received_on >= ?");
  });

  it("persists rent reimbursement only in the dedicated contribution ledger", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[contributionRow], []]);
    const contribution = {
      clientOperationKey: contributionRow.client_operation_key,
      contributionMonth: "2026-09",
      createdAtUtc: contributionRow.created_at_utc,
      description: contributionRow.description,
      dueOn: contributionRow.due_on,
      expectedAmount: contributionRow.expected_amount,
      id: contributionRow.id,
      note: null,
      projectId: contributionRow.project_id,
      projectName: contributionRow.project_name,
      projectShortCode: contributionRow.project_short_code,
      receivedAmount: contributionRow.received_amount,
      receivedOn: null,
      status: "expected" as const,
      updatedAtUtc: contributionRow.updated_at_utc,
      version: 1,
    };
    await insertContributionRecordIdempotently(
      { execute } as unknown as PoolConnection,
      contribution,
    );
    const insertSql = String(execute.mock.calls[0]?.[0]);
    expect(insertSql).toContain("INSERT INTO partnership_contribution");
    expect(insertSql).not.toMatch(/INSERT INTO expense/iu);
  });

  it("appends each partial receipt as a dedicated immutable row", async () => {
    const receiptRow = {
      amount: "3000.0000",
      client_operation_key: "50000000-0000-4000-8000-000000000001",
      contribution_id: contributionRow.id,
      created_at_utc: contributionRow.created_at_utc,
      id: "60000000-0000-4000-8000-000000000001",
      note: null,
      received_on: "2026-09-16",
    };
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[receiptRow], []]);
    await insertContributionReceiptIdempotently(
      { execute } as unknown as PoolConnection,
      {
        amount: receiptRow.amount,
        clientOperationKey: receiptRow.client_operation_key,
        contributionId: receiptRow.contribution_id,
        createdAtUtc: receiptRow.created_at_utc,
        id: receiptRow.id,
        note: null,
        receivedOn: receiptRow.received_on,
      },
    );
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "INSERT INTO partnership_contribution_receipt",
    );
  });
});
