// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  calculateVat: vi.fn(),
  findByOperation: vi.fn(),
  findByPeriod: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/features/finance/tax-repository", async () => {
  class TaxObligationPeriodCollisionError extends Error {}
  return {
    calculateVatSourceSnapshot: mocks.calculateVat,
    findTaxObligationByOperationKeyForUpdate: mocks.findByOperation,
    findTaxObligationByTypePeriodForUpdate: mocks.findByPeriod,
    findTaxObligationForUpdate: mocks.findById,
    insertTaxObligationRecordIdempotently: mocks.insert,
    listTaxObligationRecords: mocks.list,
    TaxObligationPeriodCollisionError,
    updateTaxObligationRecord: mocks.update,
  };
});
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcConsistentRead: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  createTaxObligation,
  listTaxesOverview,
  TaxObligationPeriodConflictError,
  TaxObligationVersionConflictError,
  updateTaxObligation,
} from "./tax-service";

const operationKey = "10000000-0000-4000-8000-000000000001";
const taxId = "20000000-0000-4000-8000-000000000001";
const context = {
  correlationId: "tax-test",
  now: new Date("2026-09-08T09:00:00.000Z"),
};

const baseRecord = {
  carriedVatCreditAmount: "0.0000",
  clientOperationKey: operationKey,
  closingVatCreditAmount: "0.0000",
  createdAtUtc: "2026-09-08 09:00:00.000000",
  currency: "TRY" as const,
  description: "Ağustos KDV",
  dueOn: "2026-09-28",
  id: taxId,
  manualAdjustmentAmount: "0.0000",
  note: null,
  paidOn: null,
  payableAmount: "120.0000",
  periodMonth: "2026-08",
  status: "planned" as const,
  systemInputVatAmount: "80.0000",
  systemOutputVatAmount: "200.0000",
  taxType: "vat" as const,
  updatedAtUtc: "2026-09-08 09:00:00.000000",
  version: 1,
  voidedAtUtc: null,
  voidReason: null,
};

describe("tax service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculateVat.mockResolvedValue({
      sourceExpenseCount: 2,
      sourceReceivableCount: 3,
      systemInputVatAmount: "80.0000",
      systemOutputVatAmount: "200.0000",
    });
    mocks.findByOperation.mockResolvedValue(null);
    mocks.findByPeriod.mockResolvedValue(null);
    mocks.insert.mockImplementation(async (_connection, pending) => pending);
    mocks.list.mockResolvedValue([]);
    mocks.update.mockResolvedValue(true);
  });

  it("creates audited VAT from server sources, carry and signed adjustment", async () => {
    const result = await createTaxObligation(
      {} as Pool,
      {
        carriedVatCreditAmount: "30",
        clientOperationKey: operationKey,
        description: "Ağustos KDV",
        dueOn: "2026-09-28",
        manualAdjustmentAmount: "-10",
        note: null,
        paidOn: null,
        periodMonth: "2026-08",
        status: "planned",
        taxType: "vat",
        voidReason: null,
      },
      context,
    );
    expect(result.created).toBe(true);
    expect(result.tax).toMatchObject({
      carriedVatCreditAmount: "30.0000",
      manualAdjustmentAmount: "-10.0000",
      payableAmount: "80.0000",
      systemInputVatAmount: "80.0000",
      systemNetVatAmount: "120.0000",
      systemOutputVatAmount: "200.0000",
    });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "tax_obligation.created",
        entityType: "tax_obligation",
      }),
    );
  });

  it("exposes a VAT credit without inventing a payable amount", async () => {
    mocks.calculateVat.mockResolvedValue({
      sourceExpenseCount: 1,
      sourceReceivableCount: 1,
      systemInputVatAmount: "80.0000",
      systemOutputVatAmount: "50.0000",
    });
    const result = await createTaxObligation(
      {} as Pool,
      {
        carriedVatCreditAmount: "10",
        clientOperationKey: operationKey,
        description: "Ağustos KDV",
        dueOn: "2026-09-28",
        manualAdjustmentAmount: "5",
        note: null,
        paidOn: null,
        periodMonth: "2026-08",
        status: "planned",
        taxType: "vat",
        voidReason: null,
      },
      context,
    );
    expect(result.tax).toMatchObject({
      closingVatCreditAmount: "35.0000",
      payableAmount: "0.0000",
      systemNetVatAmount: "-30.0000",
    });
  });

  it("returns the transparent estimate basis and selected-period credit", async () => {
    mocks.list.mockResolvedValue([
      { ...baseRecord, closingVatCreditAmount: "45.0000" },
    ]);
    const overview = await listTaxesOverview(
      {} as Pool,
      { periodMonth: "2026-08" },
      context.now,
    );
    expect(overview.vatEstimate).toMatchObject({
      basis: {
        input: "active_expense_incurred_period",
        openingBalancesIncluded: false,
        output: "active_contract_receivable_period",
      },
      sourceExpenseCount: 2,
      sourceReceivableCount: 3,
      systemNetVatAmount: "120.0000",
    });
    expect(mocks.list).toHaveBeenCalledWith({}, "2026-08");
    expect(overview.summary.closingVatCreditAmount).toBe("45.0000");
  });

  it("rejects duplicate periods and stale updates", async () => {
    mocks.findByPeriod.mockResolvedValueOnce(baseRecord);
    await expect(
      createTaxObligation(
        {} as Pool,
        {
          accountantAmount: "1000",
          clientOperationKey: operationKey,
          description: "Gelir vergisi",
          dueOn: "2026-09-30",
          note: null,
          paidOn: null,
          periodMonth: "2026-08",
          status: "planned",
          taxType: "income_tax",
          voidReason: null,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(TaxObligationPeriodConflictError);

    mocks.findById.mockResolvedValue({ ...baseRecord, version: 2 });
    await expect(
      updateTaxObligation(
        {} as Pool,
        taxId,
        {
          carriedVatCreditAmount: "0",
          description: "Ağustos KDV",
          dueOn: "2026-09-28",
          manualAdjustmentAmount: "0",
          note: null,
          paidOn: null,
          periodMonth: "2026-08",
          status: "planned",
          taxType: "vat",
          version: 1,
          voidReason: null,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(TaxObligationVersionConflictError);
  });
});
