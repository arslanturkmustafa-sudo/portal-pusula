// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findCommissionByOperationKeyForUpdate: vi.fn(),
  findCommissionForUpdate: vi.fn(),
  findContributionByOperationKeyForUpdate: vi.fn(),
  findContributionByProjectMonthForUpdate: vi.fn(),
  findContributionReceiptByOperationKeyForUpdate: vi.fn(),
  findContributionForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  insertCommissionRecordIdempotently: vi.fn(),
  insertContributionRecordIdempotently: vi.fn(),
  insertContributionReceiptIdempotently: vi.fn(),
  listCommissionRecords: vi.fn(),
  listContributionRecords: vi.fn(),
  listContributionReceiptRecords: vi.fn(),
  updateCommissionRecord: vi.fn(),
  updateContributionRecord: vi.fn(),
}));

vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
}));
vi.mock("./repository", () => ({
  ContributionMonthCollisionError: class extends Error {},
  findCommissionByOperationKeyForUpdate: mocks.findCommissionByOperationKeyForUpdate,
  findCommissionForUpdate: mocks.findCommissionForUpdate,
  findContributionByOperationKeyForUpdate: mocks.findContributionByOperationKeyForUpdate,
  findContributionByProjectMonthForUpdate: mocks.findContributionByProjectMonthForUpdate,
  findContributionReceiptByOperationKeyForUpdate: mocks.findContributionReceiptByOperationKeyForUpdate,
  findContributionForUpdate: mocks.findContributionForUpdate,
  insertCommissionRecordIdempotently: mocks.insertCommissionRecordIdempotently,
  insertContributionRecordIdempotently: mocks.insertContributionRecordIdempotently,
  insertContributionReceiptIdempotently: mocks.insertContributionReceiptIdempotently,
  listCommissionRecords: mocks.listCommissionRecords,
  listContributionRecords: mocks.listContributionRecords,
  listContributionReceiptRecords: mocks.listContributionReceiptRecords,
  updateCommissionRecord: mocks.updateCommissionRecord,
  updateContributionRecord: mocks.updateContributionRecord,
}));
vi.mock("@/platform/audit/repository", () => ({ appendAuditEvent: mocks.appendAuditEvent }));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: vi.fn(async (_pool: unknown, operation: (connection: object) => unknown) => operation({})),
}));

import {
  createPartnershipCommission,
  createPartnershipContribution,
  createPartnershipContributionReceipt,
  listPartnershipContributions,
  PartnershipContributionMonthConflictError,
  PartnershipContributionOverpaymentError,
  PartnershipFutureActualDateError,
  PartnershipIdempotencyConflictError,
  PartnershipProjectTypeError,
  PartnershipRecordLockedError,
  updatePartnershipCommission,
  updatePartnershipContribution,
} from "./service";

const projectId = "20000000-0000-4000-8000-000000000001";
const operationKey = "30000000-0000-4000-8000-000000000001";
const commissionId = "40000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-30T08:00:00.000Z");
const nowSql = "2026-09-30 08:00:00.000000";
const context = { correlationId: "partnership-service-test", now };

const baseCommission = {
  agencyCollectedOn: null,
  clientOperationKey: operationKey,
  closedOn: "2026-09-03",
  commissionBasisAmount: "100000.0000",
  contributionMode: "user_both" as const,
  createdAtUtc: nowSql,
  description: "Konut satışı",
  id: commissionId,
  note: null,
  paidOn: null,
  projectId,
  projectName: "7 Emlak Ajansı",
  projectShortCode: "7EMLAK",
  shareAmount: "50000.0000",
  shareRate: "0.5000",
  status: "expected" as const,
  transactionType: "sale" as const,
  updatedAtUtc: nowSql,
  version: 1,
};

describe("partnership finance service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectForUpdate.mockResolvedValue({
      displayName: "7 Emlak Ajansı",
      projectType: "partnership",
      shortCode: "7EMLAK",
    });
    mocks.findCommissionByOperationKeyForUpdate.mockResolvedValue(null);
    mocks.findContributionByOperationKeyForUpdate.mockResolvedValue(null);
    mocks.findContributionByProjectMonthForUpdate.mockResolvedValue(null);
    mocks.findContributionReceiptByOperationKeyForUpdate.mockResolvedValue(null);
    mocks.insertCommissionRecordIdempotently.mockImplementation(async (_connection, value) => value);
    mocks.insertContributionRecordIdempotently.mockImplementation(async (_connection, value) => value);
    mocks.insertContributionReceiptIdempotently.mockImplementation(async (_connection, value) => value);
    mocks.listContributionReceiptRecords.mockResolvedValue([]);
    mocks.updateCommissionRecord.mockResolvedValue(true);
    mocks.updateContributionRecord.mockResolvedValue(true);
  });

  it.each([
    ["partner_only", "0.1000", "10000.0000"],
    ["user_one_side", "0.2500", "25000.0000"],
    ["user_both", "0.5000", "50000.0000"],
  ] as const)("calculates %s commission automatically", async (contributionMode, shareRate, shareAmount) => {
    const result = await createPartnershipCommission({} as Pool, {
      clientOperationKey: operationKey,
      closedOn: "2026-09-03",
      commissionBasisAmount: "100000",
      contributionMode,
      description: "Konut satışı",
      projectId,
      transactionType: "sale",
    }, context);
    expect(result.commission).toMatchObject({ shareAmount, shareRate });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "partnership_commission.created",
      entityType: "partnership_commission",
    }));
  });

  it("rejects a non-partnership project", async () => {
    mocks.findProjectForUpdate.mockResolvedValue({ projectType: "product" });
    await expect(createPartnershipCommission({} as Pool, {
      clientOperationKey: operationKey,
      closedOn: "2026-09-03",
      commissionBasisAmount: "100000",
      contributionMode: "partner_only",
      description: "Kiralama",
      projectId,
      transactionType: "rental",
    }, context)).rejects.toBeInstanceOf(PartnershipProjectTypeError);
  });

  it("returns an identical operation once and rejects a changed retry", async () => {
    mocks.findCommissionByOperationKeyForUpdate.mockResolvedValue(baseCommission);
    const retried = await createPartnershipCommission({} as Pool, {
      clientOperationKey: operationKey,
      closedOn: baseCommission.closedOn,
      commissionBasisAmount: "100000",
      contributionMode: "user_both",
      description: baseCommission.description,
      projectId,
      transactionType: "sale",
    }, context);
    expect(retried.created).toBe(false);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
    await expect(createPartnershipCommission({} as Pool, {
      clientOperationKey: operationKey,
      closedOn: baseCommission.closedOn,
      commissionBasisAmount: "100001",
      contributionMode: "user_both",
      description: baseCommission.description,
      projectId,
      transactionType: "sale",
    }, context)).rejects.toBeInstanceOf(PartnershipIdempotencyConflictError);
  });

  it("locks the financial basis after the agency collects", async () => {
    mocks.findCommissionForUpdate.mockResolvedValue({
      ...baseCommission,
      agencyCollectedOn: "2026-09-04",
      status: "agency_collected",
    });
    await expect(updatePartnershipCommission({} as Pool, commissionId, {
      agencyCollectedOn: "2026-09-04",
      closedOn: baseCommission.closedOn,
      commissionBasisAmount: "120000",
      contributionMode: "user_both",
      description: baseCommission.description,
      note: null,
      paidOn: "2026-09-05",
      projectId,
      status: "paid",
      transactionType: "sale",
      version: 1,
    }, context)).rejects.toBeInstanceOf(PartnershipRecordLockedError);
  });

  it("rejects a future actual date while creating an already-collected commission", async () => {
    await expect(createPartnershipCommission({} as Pool, {
      agencyCollectedOn: "2026-10-01",
      clientOperationKey: operationKey,
      closedOn: "2026-09-03",
      commissionBasisAmount: "100000",
      contributionMode: "partner_only",
      description: "Kiralama",
      projectId,
      status: "agency_collected",
      transactionType: "rental",
    }, context)).rejects.toBeInstanceOf(PartnershipFutureActualDateError);
    expect(mocks.insertCommissionRecordIdempotently).not.toHaveBeenCalled();
  });

  it("rejects a future actual date while updating a commission", async () => {
    await expect(updatePartnershipCommission({} as Pool, commissionId, {
      agencyCollectedOn: "2026-10-01",
      closedOn: baseCommission.closedOn,
      commissionBasisAmount: "100000",
      contributionMode: "user_both",
      description: baseCommission.description,
      note: null,
      paidOn: null,
      projectId,
      status: "agency_collected",
      transactionType: "sale",
      version: 1,
    }, context)).rejects.toBeInstanceOf(PartnershipFutureActualDateError);
    expect(mocks.updateCommissionRecord).not.toHaveBeenCalled();
  });

  it("keeps monthly partner contribution outside expenses and summarizes partial receipts", async () => {
    mocks.listContributionRecords.mockResolvedValue([
      {
        clientOperationKey: operationKey,
        contributionMonth: "2026-09",
        createdAtUtc: nowSql,
        description: "Ofis kirası ortak katkısı",
        dueOn: "2026-09-15",
        expectedAmount: "7000.0000",
        id: commissionId,
        note: null,
        projectId,
        projectName: "7 Emlak Ajansı",
        projectShortCode: "7EMLAK",
        receivedAmount: "3000.0000",
        receivedOn: "2026-09-16",
        status: "partial",
        updatedAtUtc: nowSql,
        version: 1,
      },
    ]);
    const result = await listPartnershipContributions({} as Pool, { month: "2026-09" });
    expect(result.summary).toEqual({ outstandingAmount: "4000.0000", receivedAmount: "3000.0000" });
  });

  it("creates the 7000 TRY rent contribution as its own audited record", async () => {
    const result = await createPartnershipContribution({} as Pool, {
      clientOperationKey: operationKey,
      contributionMonth: "2026-09",
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-09-15",
      expectedAmount: "7000",
      projectId,
    }, context);
    expect(result.contribution).toMatchObject({ expectedAmount: "7000.0000", receivedAmount: "0.0000" });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "partnership_contribution.created",
      entityType: "partnership_contribution",
    }));
  });

  it("maps a concurrent project-month duplicate during contribution update", async () => {
    mocks.findContributionForUpdate.mockResolvedValue({
      clientOperationKey: operationKey,
      contributionMonth: "2026-08",
      createdAtUtc: nowSql,
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-08-15",
      expectedAmount: "7000.0000",
      id: commissionId,
      note: null,
      projectId,
      projectName: "7 Emlak Ajansı",
      projectShortCode: "7EMLAK",
      receivedAmount: "0.0000",
      receivedOn: null,
      status: "expected",
      updatedAtUtc: nowSql,
      version: 1,
    });
    mocks.updateContributionRecord.mockRejectedValue({ code: "ER_DUP_ENTRY" });

    await expect(updatePartnershipContribution({} as Pool, commissionId, {
      contributionMonth: "2026-09",
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-09-15",
      expectedAmount: "7000",
      note: null,
      projectId,
      status: "expected",
      version: 1,
    }, context)).rejects.toBeInstanceOf(PartnershipContributionMonthConflictError);
  });

  it("appends a partial receipt and updates the contribution aggregate once", async () => {
    mocks.findContributionForUpdate.mockResolvedValue({
      clientOperationKey: operationKey,
      contributionMonth: "2026-09",
      createdAtUtc: nowSql,
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-09-15",
      expectedAmount: "7000.0000",
      id: commissionId,
      note: null,
      projectId,
      projectName: "7 Emlak Ajansı",
      projectShortCode: "7EMLAK",
      receivedAmount: "0.0000",
      receivedOn: null,
      status: "expected",
      updatedAtUtc: nowSql,
      version: 1,
    });

    const result = await createPartnershipContributionReceipt({} as Pool, commissionId, {
      amount: "3000",
      clientOperationKey: "50000000-0000-4000-8000-000000000001",
      note: null,
      receivedOn: "2026-09-16",
    }, context);

    expect(result).toMatchObject({
      contribution: { receivedAmount: "3000.0000", status: "partial", version: 2 },
      created: true,
      receipt: { amount: "3000.0000", receivedOn: "2026-09-16" },
    });
    expect(mocks.updateContributionRecord).toHaveBeenCalledOnce();
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "partnership_contribution.receipt_added",
      entityType: "partnership_contribution_receipt",
    }));
  });

  it("rejects a receipt that exceeds the outstanding contribution", async () => {
    mocks.findContributionForUpdate.mockResolvedValue({
      expectedAmount: "7000.0000",
      receivedAmount: "6000.0000",
      status: "partial",
    });
    await expect(createPartnershipContributionReceipt({} as Pool, commissionId, {
      amount: "1001",
      clientOperationKey: "50000000-0000-4000-8000-000000000001",
      receivedOn: "2026-09-16",
    }, context)).rejects.toBeInstanceOf(PartnershipContributionOverpaymentError);
    expect(mocks.insertContributionReceiptIdempotently).not.toHaveBeenCalled();
  });

  it("returns an identical receipt retry without incrementing the aggregate twice", async () => {
    const receipt = {
      amount: "3000.0000",
      clientOperationKey: "50000000-0000-4000-8000-000000000001",
      contributionId: commissionId,
      createdAtUtc: nowSql,
      id: "60000000-0000-4000-8000-000000000001",
      note: null,
      receivedOn: "2026-09-16",
    };
    mocks.findContributionReceiptByOperationKeyForUpdate.mockResolvedValue(receipt);
    mocks.findContributionForUpdate.mockResolvedValue({
      id: commissionId,
      receivedAmount: "3000.0000",
      status: "partial",
    });

    const result = await createPartnershipContributionReceipt({} as Pool, commissionId, {
      amount: "3000",
      clientOperationKey: receipt.clientOperationKey,
      note: null,
      receivedOn: receipt.receivedOn,
    }, context);

    expect(result).toMatchObject({ created: false, receipt });
    expect(mocks.insertContributionReceiptIdempotently).not.toHaveBeenCalled();
    expect(mocks.updateContributionRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a future contribution receipt date", async () => {
    await expect(createPartnershipContributionReceipt({} as Pool, commissionId, {
      amount: "1000",
      clientOperationKey: "50000000-0000-4000-8000-000000000001",
      receivedOn: "2026-10-01",
    }, context)).rejects.toBeInstanceOf(PartnershipFutureActualDateError);
    expect(mocks.findContributionForUpdate).not.toHaveBeenCalled();
  });
});
