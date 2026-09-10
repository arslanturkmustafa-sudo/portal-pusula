// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  createExpenseInConnection: vi.fn(),
  findActiveExpenseCategoryByCodeForUpdate: vi.fn(),
  findCreditCardForUpdate: vi.fn(),
  findFinanceAccountForUpdate: vi.fn(),
  findPlanByOperationKeyForUpdate: vi.fn(),
  findPlanForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  insertPlanIdempotently: vi.fn(),
  listPlanRecords: vi.fn(),
  updatePlanRecord: vi.fn(),
}));

vi.mock("@/features/finance/account-service", () => ({
  FinanceAccountInactiveError: class FinanceAccountInactiveError extends Error {},
  FinanceAccountNotFoundError: class FinanceAccountNotFoundError extends Error {},
}));
vi.mock("@/features/finance/account-repository", () => ({
  findFinanceAccountForUpdate: mocks.findFinanceAccountForUpdate,
}));
vi.mock("@/features/finance/expense-category-repository", () => ({
  findActiveExpenseCategoryByCodeForUpdate:
    mocks.findActiveExpenseCategoryByCodeForUpdate,
}));
vi.mock("@/features/finance/recurring-expense-repository", () => ({
  findRecurringExpensePlanByOperationKeyForUpdate:
    mocks.findPlanByOperationKeyForUpdate,
  findRecurringExpensePlanForUpdate: mocks.findPlanForUpdate,
  insertRecurringExpensePlanIdempotently: mocks.insertPlanIdempotently,
  listRecurringExpensePlanRecords: mocks.listPlanRecords,
  updateRecurringExpensePlanRecord: mocks.updatePlanRecord,
}));
vi.mock("@/features/finance/spending-repository", () => ({
  findCreditCardForUpdate: mocks.findCreditCardForUpdate,
}));
vi.mock("@/features/finance/spending-service", () => ({
  createExpenseInConnection: mocks.createExpenseInConnection,
  CreditCardInactiveError: class CreditCardInactiveError extends Error {},
  ExpenseSourceAccountTypeError: class ExpenseSourceAccountTypeError extends Error {},
  SpendingResourceNotFoundError: class SpendingResourceNotFoundError extends Error {},
}));
vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
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
  createRecurringExpensePlan,
  realizeRecurringExpensePlan,
} from "@/features/finance/recurring-expense-service";

const planId = "10000000-0000-4000-8000-000000000001";
const operationKey = "20000000-0000-4000-8000-000000000001";
const accountId = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-02-01T09:00:00.000Z");
const context = {
  actorId: "40000000-0000-4000-8000-000000000001",
  canMutateAccountLedger: true,
  correlationId: "recurring-expense-test",
  now,
};

function plan(overrides: Record<string, unknown> = {}) {
  return {
    anchorDay: 31,
    category: "rent",
    clientOperationKey: operationKey,
    createdAtUtc: "2026-01-01 09:00:00.000000",
    creditCardId: null,
    creditCardName: null,
    currency: "TRY" as const,
    description: "Ofis kirası",
    endsOn: null,
    frequency: "monthly" as const,
    id: planId,
    netAmount: "100.0000",
    nextDueOn: "2026-01-31",
    note: "Kira planı",
    paymentMethod: "cash" as const,
    projectId: null,
    projectName: null,
    projectShortCode: null,
    sourceAccountId: accountId,
    sourceAccountName: "Merkez kasa",
    sourceAccountType: "cash" as const,
    status: "active" as const,
    totalAmount: "120.0000",
    updatedAtUtc: "2026-01-01 09:00:00.000000",
    vatAmount: "20.0000",
    vendorName: "Mal sahibi",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveExpenseCategoryByCodeForUpdate.mockResolvedValue({ code: "rent" });
  mocks.findFinanceAccountForUpdate.mockResolvedValue({
    accountType: "cash",
    id: accountId,
    status: "active",
  });
  mocks.findPlanByOperationKeyForUpdate.mockResolvedValue(null);
  mocks.insertPlanIdempotently.mockImplementation(
    async (_connection: unknown, value: unknown) => value,
  );
  mocks.updatePlanRecord.mockResolvedValue(true);
});

describe("recurring expense service", () => {
  it("creates a VAT snapshot plan without realizing a ledger expense", async () => {
    const result = await createRecurringExpensePlan(
      {} as Pool,
      {
        category: "rent",
        clientOperationKey: operationKey,
        creditCardId: null,
        description: "Ofis kirası",
        endsOn: null,
        firstDueOn: "2026-01-31",
        frequency: "monthly",
        netAmount: "100",
        note: null,
        paymentMethod: "cash",
        projectId: null,
        sourceAccountId: accountId,
        vatAmount: "20",
        vendorName: null,
      },
      context,
    );

    expect(result.plan).toMatchObject({
      netAmount: "100.0000",
      totalAmount: "120.0000",
      vatAmount: "20.0000",
    });
    expect(mocks.createExpenseInConnection).not.toHaveBeenCalled();
  });

  it("realizes the stored net and VAT snapshot then preserves the monthly anchor", async () => {
    const storedPlan = plan();
    mocks.findPlanForUpdate.mockResolvedValue(storedPlan);
    mocks.createExpenseInConnection.mockResolvedValue({
      created: true,
      expense: { id: "50000000-0000-4000-8000-000000000001" },
    });

    const result = await realizeRecurringExpensePlan(
      {} as Pool,
      planId,
      { version: 1 },
      context,
    );

    expect(mocks.createExpenseInConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        incurredOn: "2026-01-31",
        netAmount: "100.0000",
        vatAmount: "20.0000",
      }),
      expect.anything(),
    );
    expect(mocks.updatePlanRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nextDueOn: "2026-02-28", version: 2 }),
      1,
    );
    expect(result.plan.nextDueOn).toBe("2026-02-28");
  });
});
