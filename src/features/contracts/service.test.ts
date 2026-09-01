// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  contractHasVisitOutsideRange: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findOverlappingContract: vi.fn(),
  findOwnedContractForUpdate: vi.fn(),
  updateContractRecord: vi.fn(),
}));

vi.mock("@/features/customers/repository", () => ({
  findCustomerForUpdate: mocks.findCustomerForUpdate,
}));

vi.mock("@/features/contracts/repository", () => ({
  contractHasVisitOutsideRange: mocks.contractHasVisitOutsideRange,
  deletePlannedMonthVisits: vi.fn(),
  findOverlappingContract: mocks.findOverlappingContract,
  findOwnedContractForUpdate: mocks.findOwnedContractForUpdate,
  findOwnedVisitForUpdate: vi.fn(),
  insertContractRecord: vi.fn(),
  insertVisitRecords: vi.fn(),
  listContractRecords: vi.fn(),
  listMonthVisitRecords: vi.fn(),
  updateContractRecord: mocks.updateContractRecord,
  updateVisitRecord: vi.fn(),
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
  ContractPeriodConflictError,
  ContractVisitRangeConflictError,
  updateCustomerContract,
} from "@/features/contracts/service";

const customerId = "10000000-0000-4000-8000-000000000001";
const contractId = "20000000-0000-4000-8000-000000000001";
const before = {
  createdAtUtc: "2026-09-01 09:00:00.000000",
  currency: "TRY" as const,
  customerId,
  endsOn: "2027-08-31",
  id: contractId,
  internalNote: null,
  monthlyFeeAmount: "50000.0000",
  paymentDay: 5,
  startsOn: "2026-09-01",
  status: "active" as const,
  updatedAtUtc: "2026-09-01 09:00:00.000000",
  vatMode: "exclusive" as const,
  vatRate: "20.00",
};
const input = {
  endsOn: "2026-12-31",
  internalNote: "2026 çalışma dönemi",
  monthlyFeeAmount: "60000",
  paymentDay: 15,
  startsOn: "2026-02-01",
  status: "active" as const,
  vatMode: "exempt" as const,
  vatRate: "0",
};
const context = {
  correlationId: "contract-edit-test",
  now: new Date("2026-09-01T12:00:00.000Z"),
};

describe("contract edit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerForUpdate.mockResolvedValue({
      id: customerId,
      status: "active",
    });
    mocks.findOwnedContractForUpdate.mockResolvedValue(before);
    mocks.findOverlappingContract.mockResolvedValue(null);
    mocks.contractHasVisitOutsideRange.mockResolvedValue(false);
  });

  it("updates the owned contract transactionally and appends before/after audit", async () => {
    const result = await updateCustomerContract(
      {} as Pool,
      customerId,
      contractId,
      input,
      context,
    );

    expect(result).toMatchObject({
      endsOn: "2026-12-31",
      monthlyFeeAmount: "60000.0000",
      paymentDay: 15,
      startsOn: "2026-02-01",
      vatMode: "exempt",
      vatRate: "0.00",
    });
    expect(mocks.findOverlappingContract).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      "2026-02-01",
      "2026-12-31",
      contractId,
    );
    expect(mocks.updateContractRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "consulting_contract.updated",
        beforeSummary: expect.objectContaining({ startsOn: "2026-09-01" }),
        afterSummary: expect.objectContaining({ startsOn: "2026-02-01" }),
      }),
    );
  });

  it("rejects overlap before updating or auditing", async () => {
    mocks.findOverlappingContract.mockResolvedValue({
      ...before,
      id: "20000000-0000-4000-8000-000000000002",
    });

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        input,
        context,
      ),
    ).rejects.toBeInstanceOf(ContractPeriodConflictError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("maps the database unique constraint to the same friendly conflict", async () => {
    mocks.updateContractRecord.mockRejectedValue({ code: "ER_DUP_ENTRY" });

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        input,
        context,
      ),
    ).rejects.toBeInstanceOf(ContractPeriodConflictError);
  });

  it("does not allow an edit to strand an existing visit outside the period", async () => {
    mocks.contractHasVisitOutsideRange.mockResolvedValue(true);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        input,
        context,
      ),
    ).rejects.toBeInstanceOf(ContractVisitRangeConflictError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });
});
