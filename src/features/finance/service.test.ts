// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findActiveCustomerProjectForUpdate: vi.fn(),
  findCollectionByClientOperationKeyForUpdate: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findFinanceContractForUpdate: vi.fn(),
  findGeneratedReceivableForUpdate: vi.fn(),
  findReceivableForUpdate: vi.fn(),
  insertCollectionRecordIdempotently: vi.fn(),
  insertOpeningBalanceRecordIdempotently: vi.fn(),
  insertReceivableRecord: vi.fn(),
  listReceivableRecords: vi.fn(),
}));

vi.mock("@/features/customers/repository", () => ({
  findActiveCustomerProjectForUpdate: mocks.findActiveCustomerProjectForUpdate,
  findCustomerForUpdate: mocks.findCustomerForUpdate,
}));

vi.mock("@/features/finance/repository", () => ({
  findCollectionByClientOperationKeyForUpdate:
    mocks.findCollectionByClientOperationKeyForUpdate,
  findFinanceContractForUpdate: mocks.findFinanceContractForUpdate,
  findGeneratedReceivableForUpdate: mocks.findGeneratedReceivableForUpdate,
  findReceivableForUpdate: mocks.findReceivableForUpdate,
  insertCollectionRecordIdempotently:
    mocks.insertCollectionRecordIdempotently,
  insertOpeningBalanceRecordIdempotently:
    mocks.insertOpeningBalanceRecordIdempotently,
  insertReceivableRecord: mocks.insertReceivableRecord,
  listReceivableRecords: mocks.listReceivableRecords,
}));

vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  CollectionDateInFutureError,
  CollectionExceedsOutstandingError,
  ContractNotBillableError,
  createOpeningBalance,
  createReceivableCollection,
  FinanceContractProjectMissingError,
  FinanceCustomerProjectUnavailableError,
  FinanceIdempotencyConflictError,
  generateContractMonthReceivable,
  listFinanceReceivables,
} from "@/features/finance/service";

const projectId = "70000000-0000-4000-8000-000000000001";
const receivable = {
  collectedAmount: "25.0000",
  contractId: "20000000-0000-4000-8000-000000000001",
  createdAtUtc: "2026-09-01 09:00:00.000000",
  currency: "TRY" as const,
  customerId: "10000000-0000-4000-8000-000000000001",
  customerName: "Test Müşterisi",
  description: "2026-09 aylık danışmanlık hizmeti",
  dueOn: "2026-09-05",
  id: "30000000-0000-4000-8000-000000000001",
  netAmount: "100.0000",
  periodMonth: "2026-09",
  projectId,
  projectName: "Mühendis Kafası",
  projectShortCode: "MUHENDIS_KAFASI",
  sourceType: "contract_month" as const,
  totalAmount: "120.0000",
  updatedAtUtc: "2026-09-01 09:00:00.000000",
  vatAmount: "20.0000",
};

const context = {
  correlationId: "correlation-1",
  now: new Date("2026-09-01T09:00:00.000Z"),
};
const clientOperationKey = "40000000-0000-4000-8000-000000000001";

describe("finance write service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCollectionByClientOperationKeyForUpdate.mockResolvedValue(null);
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue({
      customerId: receivable.customerId,
      projectId,
    });
  });

  it("summarizes current-month remaining and collected amounts as decimal strings", async () => {
    mocks.listReceivableRecords.mockResolvedValue({
      collectedAmountInRange: "40.0000",
      receivables: [
        { ...receivable, dueOn: "2026-09-20" },
        {
          ...receivable,
          collectedAmount: "0.0000",
          dueOn: "2026-08-20",
          id: "30000000-0000-4000-8000-000000000002",
          totalAmount: "50.0000",
        },
        {
          ...receivable,
          collectedAmount: "10.0000",
          dueOn: "2026-09-10",
          id: "30000000-0000-4000-8000-000000000003",
          totalAmount: "10.0000",
        },
      ],
    });

    const result = await listFinanceReceivables(
      {} as Pool,
      new Date("2026-09-15T09:00:00.000Z"),
    );

    expect(result.summary).toEqual({
      collectedThisMonth: "40.0000",
      dueThisMonth: "95.0000",
      outstanding: "145.0000",
      overdue: "50.0000",
      totalCollected: "35.0000",
      totalReceivable: "180.0000",
    });
    expect(mocks.listReceivableRecords).toHaveBeenCalledWith(
      expect.anything(),
      "2026-09-01",
      "2026-10-01",
      undefined,
    );
  });

  it("returns an existing contract-month receivable without another insert or audit", async () => {
    mocks.findFinanceContractForUpdate.mockResolvedValue({
      customerId: receivable.customerId,
      endsOn: "2027-08-31",
      id: receivable.contractId,
      monthlyFeeAmount: "100.0000",
      paymentDay: 5,
      projectId,
      startsOn: "2026-09-01",
      status: "active",
      vatMode: "exclusive",
      vatRate: "20.00",
    });
    mocks.findGeneratedReceivableForUpdate.mockResolvedValue(receivable);

    await expect(
      generateContractMonthReceivable(
        {} as Pool,
        { contractId: receivable.contractId, month: "2026-09" },
        context,
      ),
    ).resolves.toMatchObject({ created: false, receivable: { id: receivable.id } });
    expect(mocks.insertReceivableRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("does not generate a new receivable from a closed contract", async () => {
    mocks.findFinanceContractForUpdate.mockResolvedValue({
      customerId: receivable.customerId,
      endsOn: "2026-08-31",
      id: receivable.contractId,
      monthlyFeeAmount: "100.0000",
      paymentDay: 5,
      projectId,
      startsOn: "2025-09-01",
      status: "closed",
      vatMode: "exclusive",
      vatRate: "20.00",
    });

    await expect(
      generateContractMonthReceivable(
        {} as Pool,
        { contractId: receivable.contractId, month: "2026-08" },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractNotBillableError);
    expect(mocks.findGeneratedReceivableForUpdate).not.toHaveBeenCalled();
    expect(mocks.insertReceivableRecord).not.toHaveBeenCalled();
  });

  it("does not generate a receivable until a legacy contract is assigned to a project", async () => {
    mocks.findFinanceContractForUpdate.mockResolvedValue({
      customerId: receivable.customerId,
      endsOn: "2027-08-31",
      id: receivable.contractId,
      monthlyFeeAmount: "100.0000",
      paymentDay: 5,
      projectId: null,
      startsOn: "2026-09-01",
      status: "active",
      vatMode: "exclusive",
      vatRate: "20.00",
    });

    await expect(
      generateContractMonthReceivable(
        {} as Pool,
        { contractId: receivable.contractId, month: "2026-09" },
        context,
      ),
    ).rejects.toBeInstanceOf(FinanceContractProjectMissingError);
    expect(mocks.findGeneratedReceivableForUpdate).not.toHaveBeenCalled();
    expect(mocks.insertReceivableRecord).not.toHaveBeenCalled();
  });

  it("generates a boundary-month snapshot from the prorated contract fee", async () => {
    mocks.findFinanceContractForUpdate.mockResolvedValue({
      customerId: receivable.customerId,
      endsOn: "2027-08-14",
      id: receivable.contractId,
      monthlyFeeAmount: "120000.0000",
      paymentDay: 5,
      projectId,
      startsOn: "2026-09-15",
      status: "active",
      vatMode: "exclusive",
      vatRate: "20.00",
    });
    mocks.findGeneratedReceivableForUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...receivable,
        netAmount: "64000.0000",
        totalAmount: "76800.0000",
        vatAmount: "12800.0000",
      });

    await generateContractMonthReceivable(
      {} as Pool,
      { contractId: receivable.contractId, month: "2026-09" },
      context,
    );

    expect(mocks.insertReceivableRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        netAmount: "64000.0000",
        totalAmount: "76800.0000",
        vatAmount: "12800.0000",
      }),
    );
  });

  it("accepts a partial collection and returns recalculated monetary strings", async () => {
    mocks.findReceivableForUpdate.mockResolvedValue(receivable);
    mocks.insertCollectionRecordIdempotently.mockImplementation(
      async (_connection, collection) => collection,
    );

    const result = await createReceivableCollection(
      {} as Pool,
      {
        amount: "25",
        clientOperationKey,
        collectedOn: "2026-09-01",
        note: null,
        receivableId: receivable.id,
      },
      context,
    );

    expect(result.collection.amount).toBe("25.0000");
    expect(result.receivable.collectedAmount).toBe("50.0000");
    expect(result.receivable.outstandingAmount).toBe("70.0000");
    expect(result.receivable.status).toBe("partial");
    expect(result.created).toBe(true);
    expect(mocks.insertCollectionRecordIdempotently).toHaveBeenCalledOnce();
    expect(mocks.appendAuditEvent).toHaveBeenCalledOnce();
  });

  it("rejects overpayment before inserting a collection or audit event", async () => {
    mocks.findReceivableForUpdate.mockResolvedValue({
      ...receivable,
      collectedAmount: "110.0000",
    });

    await expect(
      createReceivableCollection(
        {} as Pool,
        {
          amount: "10.0001",
          clientOperationKey,
          collectedOn: "2026-09-01",
          note: null,
          receivableId: receivable.id,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CollectionExceedsOutstandingError);
    expect(mocks.insertCollectionRecordIdempotently).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a future collection date before opening a database transaction", async () => {
    await expect(
      createReceivableCollection(
        {} as Pool,
        {
          amount: "10",
          clientOperationKey,
          collectedOn: "2026-09-02",
          note: null,
          receivableId: receivable.id,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CollectionDateInFutureError);
    expect(mocks.findReceivableForUpdate).not.toHaveBeenCalled();
    expect(mocks.insertCollectionRecordIdempotently).not.toHaveBeenCalled();
  });

  it("returns the first collection for an identical operation-key replay without another write", async () => {
    const persistedCollection = {
      amount: "25.0000",
      clientOperationKey,
      collectedOn: "2026-09-01",
      createdAtUtc: "2026-09-01 09:00:00.000000",
      id: "50000000-0000-4000-8000-000000000001",
      note: null,
      receivableId: receivable.id,
    };
    mocks.findCollectionByClientOperationKeyForUpdate.mockResolvedValueOnce(
      persistedCollection,
    );
    mocks.findReceivableForUpdate.mockResolvedValue({
      ...receivable,
      collectedAmount: "50.0000",
    });

    const result = await createReceivableCollection(
      {} as Pool,
      {
        amount: "25",
        clientOperationKey,
        collectedOn: "2026-09-01",
        note: null,
        receivableId: receivable.id,
      },
      context,
    );

    expect(result).toMatchObject({ created: false, collection: persistedCollection });
    expect(mocks.insertCollectionRecordIdempotently).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects reusing a collection operation key with a different payload", async () => {
    mocks.findCollectionByClientOperationKeyForUpdate.mockResolvedValueOnce({
      amount: "20.0000",
      clientOperationKey,
      collectedOn: "2026-09-01",
      createdAtUtc: "2026-09-01 09:00:00.000000",
      id: "50000000-0000-4000-8000-000000000001",
      note: null,
      receivableId: receivable.id,
    });

    await expect(
      createReceivableCollection(
        {} as Pool,
        {
          amount: "25",
          clientOperationKey,
          collectedOn: "2026-09-01",
          note: null,
          receivableId: receivable.id,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(FinanceIdempotencyConflictError);
    expect(mocks.findReceivableForUpdate).not.toHaveBeenCalled();
  });

  it("returns an identical opening-balance replay without a second audit", async () => {
    mocks.findCustomerForUpdate.mockResolvedValue({
      id: receivable.customerId,
    });
    mocks.insertOpeningBalanceRecordIdempotently.mockResolvedValue({
      ...receivable,
      collectedAmount: "0.0000",
      contractId: null,
      description: "Devreden alacak",
      dueOn: "2026-08-15",
      id: "60000000-0000-4000-8000-000000000001",
      netAmount: "100.0000",
      periodMonth: null,
      sourceType: "opening_balance",
      totalAmount: "100.0000",
      vatAmount: "0.0000",
    });

    const result = await createOpeningBalance(
      {} as Pool,
      {
        clientOperationKey,
        customerId: receivable.customerId,
        description: "Devreden alacak",
        dueOn: "2026-08-15",
        netAmount: "100",
        projectId,
        vatAmount: "0",
      },
      context,
    );

    expect(result.created).toBe(false);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an opening balance outside the customer's active project portfolio", async () => {
    mocks.findCustomerForUpdate.mockResolvedValue({ id: receivable.customerId });
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      createOpeningBalance(
        {} as Pool,
        {
          clientOperationKey,
          customerId: receivable.customerId,
          description: "Devreden alacak",
          dueOn: "2026-08-15",
          netAmount: "100",
          projectId,
          vatAmount: "0",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(FinanceCustomerProjectUnavailableError);
    expect(mocks.insertOpeningBalanceRecordIdempotently).not.toHaveBeenCalled();
  });
});
