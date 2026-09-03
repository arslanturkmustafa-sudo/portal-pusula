// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  contractHasReceivable: vi.fn(),
  contractHasVisitOutsideRange: vi.fn(),
  findActiveCustomerProjectForUpdate: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findOverlappingContract: vi.fn(),
  findOwnedContractForUpdate: vi.fn(),
  insertContractRecord: vi.fn(),
  updateContractRecord: vi.fn(),
}));

vi.mock("@/features/customers/repository", () => ({
  findActiveCustomerProjectForUpdate: mocks.findActiveCustomerProjectForUpdate,
  findCustomerForUpdate: mocks.findCustomerForUpdate,
}));

vi.mock("@/features/contracts/repository", () => ({
  contractHasVisitOutsideRange: mocks.contractHasVisitOutsideRange,
  contractHasReceivable: mocks.contractHasReceivable,
  deletePlannedMonthVisits: vi.fn(),
  findOverlappingContract: mocks.findOverlappingContract,
  findOwnedContractForUpdate: mocks.findOwnedContractForUpdate,
  findOwnedVisitForUpdate: vi.fn(),
  insertContractRecord: mocks.insertContractRecord,
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
  ContractProjectLockedError,
  ContractProjectUnavailableError,
  ContractVisitRangeConflictError,
  createCustomerContract,
  updateCustomerContract,
} from "@/features/contracts/service";

const customerId = "10000000-0000-4000-8000-000000000001";
const contractId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const otherProjectId = "30000000-0000-4000-8000-000000000002";
const before = {
  createdAtUtc: "2026-09-01 09:00:00.000000",
  currency: "TRY" as const,
  customerId,
  endsOn: "2027-08-31",
  id: contractId,
  internalNote: null,
  monthlyFeeAmount: "50000.0000",
  paymentDay: 5,
  projectId,
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
  projectId,
  startsOn: "2026-02-01",
  status: "active" as const,
  vatMode: "exempt" as const,
  vatRate: "0",
};
const context = {
  correlationId: "contract-edit-test",
  now: new Date("2026-09-01T12:00:00.000Z"),
};

describe("contract write service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerForUpdate.mockResolvedValue({
      id: customerId,
      status: "active",
    });
    mocks.findOwnedContractForUpdate.mockResolvedValue(before);
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue({
      customerId,
      projectId,
    });
    mocks.findOverlappingContract.mockResolvedValue(null);
    mocks.contractHasReceivable.mockResolvedValue(false);
    mocks.contractHasVisitOutsideRange.mockResolvedValue(false);
    mocks.updateContractRecord.mockResolvedValue(undefined);
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
      projectId,
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

  it("creates a project-scoped contract for an active customer-project link", async () => {
    const result = await createCustomerContract(
      {} as Pool,
      customerId,
      input,
      context,
    );

    expect(result.projectId).toBe(projectId);
    expect(mocks.findActiveCustomerProjectForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      projectId,
    );
    expect(mocks.findOverlappingContract).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      projectId,
      input.startsOn,
      input.endsOn,
    );
    expect(mocks.insertContractRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "consulting_contract.created",
        afterSummary: expect.objectContaining({ projectId }),
      }),
    );
  });

  it("rejects contract creation outside the customer's active project portfolio", async () => {
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      createCustomerContract(
        {} as Pool,
        customerId,
        { ...input, projectId: otherProjectId },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectUnavailableError);
    expect(mocks.findOverlappingContract).not.toHaveBeenCalled();
    expect(mocks.insertContractRecord).not.toHaveBeenCalled();
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

  it("rejects a project outside the customer's active project portfolio", async () => {
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        { ...input, projectId: otherProjectId },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectUnavailableError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });

  it("allows corrections to a closed historical contract when its project link is inactive", async () => {
    mocks.findOwnedContractForUpdate.mockResolvedValue({
      ...before,
      status: "closed",
    });
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    const result = await updateCustomerContract(
      {} as Pool,
      customerId,
      contractId,
      { ...input, projectId, status: "closed" },
      context,
    );

    expect(result).toMatchObject({
      internalNote: "2026 çalışma dönemi",
      projectId,
      status: "closed",
    });
    expect(mocks.findActiveCustomerProjectForUpdate).not.toHaveBeenCalled();
    expect(mocks.contractHasReceivable).not.toHaveBeenCalled();
    expect(mocks.updateContractRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
    );
  });

  it("requires an active project link before reopening a historical contract", async () => {
    mocks.findOwnedContractForUpdate.mockResolvedValue({
      ...before,
      status: "closed",
    });
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        { ...input, projectId, status: "active" },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectUnavailableError);
    expect(mocks.contractHasReceivable).not.toHaveBeenCalled();
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });

  it("locks project attribution after the contract has produced a receivable", async () => {
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue({
      customerId,
      projectId: otherProjectId,
    });
    mocks.contractHasReceivable.mockResolvedValue(true);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        { ...input, projectId: otherProjectId },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectLockedError);
    expect(mocks.findOverlappingContract).not.toHaveBeenCalled();
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });
});
