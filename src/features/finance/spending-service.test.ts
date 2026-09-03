// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  deletePlannedExpenseInstallments: vi.fn(),
  findCardInstallmentForUpdate: vi.fn(),
  findCreditCardForUpdate: vi.fn(),
  findExpenseByOperationKeyForUpdate: vi.fn(),
  findExpenseForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  insertCardInstallmentRecords: vi.fn(),
  insertCreditCardRecordIdempotently: vi.fn(),
  insertExpenseRecordIdempotently: vi.fn(),
  listCardInstallmentRecords: vi.fn(),
  listCreditCardRecords: vi.fn(),
  listExpenseInstallmentsForUpdate: vi.fn(),
  listExpenseRecords: vi.fn(),
  updateCardInstallmentRecord: vi.fn(),
  updateCreditCardRecord: vi.fn(),
  updateExpenseRecord: vi.fn(),
}));

vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
}));
vi.mock("@/features/finance/spending-repository", () => ({
  deletePlannedExpenseInstallments: mocks.deletePlannedExpenseInstallments,
  findCardInstallmentForUpdate: mocks.findCardInstallmentForUpdate,
  findCreditCardForUpdate: mocks.findCreditCardForUpdate,
  findExpenseByOperationKeyForUpdate: mocks.findExpenseByOperationKeyForUpdate,
  findExpenseForUpdate: mocks.findExpenseForUpdate,
  insertCardInstallmentRecords: mocks.insertCardInstallmentRecords,
  insertCreditCardRecordIdempotently:
    mocks.insertCreditCardRecordIdempotently,
  insertExpenseRecordIdempotently: mocks.insertExpenseRecordIdempotently,
  listCardInstallmentRecords: mocks.listCardInstallmentRecords,
  listCreditCardRecords: mocks.listCreditCardRecords,
  listExpenseInstallmentsForUpdate: mocks.listExpenseInstallmentsForUpdate,
  listExpenseRecords: mocks.listExpenseRecords,
  updateCardInstallmentRecord: mocks.updateCardInstallmentRecord,
  updateCreditCardRecord: mocks.updateCreditCardRecord,
  updateExpenseRecord: mocks.updateExpenseRecord,
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
  createCreditCard,
  createExpense,
  ExpensePlanLockedError,
  listCardInstallments,
  listExpenses,
  updateCardInstallment,
  updateExpense,
} from "@/features/finance/spending-service";

const cardId = "20000000-0000-4000-8000-000000000001";
const expenseId = "30000000-0000-4000-8000-000000000001";
const projectId = "40000000-0000-4000-8000-000000000001";
const operationKey = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-03T08:00:00.000Z");
const nowSql = "2026-09-03 08:00:00.000000";
const context = { correlationId: "spending-service-test", now };

const card = {
  bankName: "Örnek Banka",
  clientOperationKey: operationKey,
  createdAtUtc: nowSql,
  creditLimitAmount: "100000.0000",
  displayName: "Şirket kartı",
  id: cardId,
  lastFour: "1234",
  note: null,
  paymentDueDay: 5,
  statementClosingDay: 25,
  status: "active" as const,
  updatedAtUtc: nowSql,
  version: 1,
};

const expense = {
  category: "software_subscription" as const,
  clientOperationKey: operationKey,
  createdAtUtc: nowSql,
  creditCardId: cardId,
  creditCardName: card.displayName,
  currency: "TRY" as const,
  description: "Yazılım aboneliği",
  documentNumber: "INV-1",
  documentType: "invoice" as const,
  id: expenseId,
  incurredOn: "2026-09-26",
  installmentCount: 3,
  netAmount: "100.0000",
  note: null,
  paymentMethod: "credit_card" as const,
  projectId,
  projectName: "ByPusula",
  projectShortCode: "BYPUSULA",
  status: "active" as const,
  totalAmount: "120.0000",
  updatedAtUtc: nowSql,
  vatAmount: "20.0000",
  vendorName: "Örnek Teknoloji",
  version: 1,
  voidedAtUtc: null,
  voidReason: null,
};

describe("spending service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCreditCardForUpdate.mockResolvedValue(card);
    mocks.findExpenseByOperationKeyForUpdate.mockResolvedValue(null);
    mocks.findProjectForUpdate.mockResolvedValue({ id: projectId });
    mocks.insertCreditCardRecordIdempotently.mockImplementation(
      async (_connection, pending) => pending,
    );
    mocks.insertExpenseRecordIdempotently.mockImplementation(
      async (_connection, pending) => ({
        ...pending,
        projectName: "ByPusula",
        projectShortCode: "BYPUSULA",
      }),
    );
    mocks.listExpenseInstallmentsForUpdate.mockResolvedValue([]);
    mocks.updateExpenseRecord.mockResolvedValue(true);
  });

  it("creates an idempotent card and writes one audit event", async () => {
    const result = await createCreditCard(
      {} as Pool,
      {
        bankName: card.bankName,
        clientOperationKey: operationKey,
        creditLimitAmount: "100000",
        displayName: card.displayName,
        lastFour: card.lastFour,
        note: null,
        paymentDueDay: 5,
        statementClosingDay: 25,
        status: "active",
      },
      context,
    );
    expect(result.created).toBe(true);
    expect(result.card.creditLimitAmount).toBe("100000.0000");
    expect(mocks.appendAuditEvent).toHaveBeenCalledOnce();
  });

  it("creates a card expense and all installments in the same transaction", async () => {
    const result = await createExpense(
      {} as Pool,
      {
        category: expense.category,
        clientOperationKey: operationKey,
        creditCardId: cardId,
        description: expense.description,
        documentNumber: expense.documentNumber,
        documentType: expense.documentType,
        incurredOn: expense.incurredOn,
        installmentCount: 3,
        netAmount: "100",
        note: null,
        paymentMethod: "credit_card",
        projectId,
        vatAmount: "20",
        vendorName: expense.vendorName,
      },
      context,
    );
    expect(result).toMatchObject({ created: true, expense: { totalAmount: "120.0000" } });
    const inserted = mocks.insertCardInstallmentRecords.mock.calls[0]?.[1];
    expect(inserted).toHaveLength(3);
    expect(inserted.map((item: { amount: string }) => item.amount)).toEqual([
      "40.0000",
      "40.0000",
      "40.0000",
    ]);
    expect(inserted[0]).toMatchObject({
      dueOn: "2026-11-05",
      statementMonth: "2026-10",
    });
  });

  it("does not allow a paid card plan to be changed or voided", async () => {
    mocks.findExpenseForUpdate.mockResolvedValue(expense);
    mocks.listExpenseInstallmentsForUpdate.mockResolvedValue([
      { status: "paid" },
    ]);
    await expect(
      updateExpense(
        {} as Pool,
        expenseId,
        {
          category: expense.category,
          creditCardId: cardId,
          description: expense.description,
          documentNumber: expense.documentNumber,
          documentType: expense.documentType,
          incurredOn: expense.incurredOn,
          installmentCount: 3,
          netAmount: "100",
          note: null,
          paymentMethod: "credit_card",
          projectId,
          status: "voided",
          vatAmount: "20",
          vendorName: expense.vendorName,
          version: 1,
          voidReason: "Mükerrer kayıt",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ExpensePlanLockedError);
    expect(mocks.updateExpenseRecord).not.toHaveBeenCalled();
  });

  it("summarizes only active expenses with exact decimal strings", async () => {
    mocks.listExpenseRecords.mockResolvedValue([
      expense,
      { ...expense, id: `${expenseId.slice(0, -1)}2`, status: "voided" },
      {
        ...expense,
        creditCardId: null,
        id: `${expenseId.slice(0, -1)}3`,
        paymentMethod: "cash",
        totalAmount: "10.0000",
        vatAmount: "0.0000",
      },
    ]);
    const result = await listExpenses({} as Pool, { month: "2026-09" });
    expect(result.summary).toEqual({
      activeExpenseCount: 2,
      creditCardAmount: "120.0000",
      totalAmount: "130.0000",
      vatAmount: "20.0000",
    });
    expect(mocks.listExpenseRecords).toHaveBeenCalledWith(
      expect.anything(),
      { month: "2026-09" },
      { nextStartOn: "2026-10-01", startOn: "2026-09-01" },
    );
  });

  it("derives overdue status without changing the stored plan", async () => {
    mocks.listCardInstallmentRecords.mockResolvedValue([
      {
        amount: "40.0000",
        createdAtUtc: nowSql,
        creditCardId: cardId,
        creditCardName: card.displayName,
        dueOn: "2026-09-01",
        expenseDescription: expense.description,
        expenseId,
        id: "60000000-0000-4000-8000-000000000001",
        installmentCount: 3,
        installmentNumber: 1,
        paidOn: null,
        statementMonth: "2026-08",
        status: "planned",
        updatedAtUtc: nowSql,
        version: 1,
      },
    ]);
    const result = await listCardInstallments({} as Pool, {}, now);
    expect(result.installments[0]?.status).toBe("overdue");
    expect(result.summary).toMatchObject({
      openAmount: "40.0000",
      overdueAmount: "40.0000",
    });
  });

  it("returns an overdue view when a past-due installment is reopened", async () => {
    mocks.findCardInstallmentForUpdate.mockResolvedValue({
      amount: "40.0000",
      createdAtUtc: nowSql,
      creditCardId: cardId,
      creditCardName: card.displayName,
      dueOn: "2026-09-01",
      expenseDescription: expense.description,
      expenseId,
      expenseStatus: "active",
      id: "60000000-0000-4000-8000-000000000001",
      installmentCount: 3,
      installmentNumber: 1,
      paidOn: "2026-09-02",
      statementMonth: "2026-08",
      status: "paid",
      updatedAtUtc: nowSql,
      version: 1,
    });
    mocks.updateCardInstallmentRecord.mockResolvedValue(true);

    const result = await updateCardInstallment(
      {} as Pool,
      "60000000-0000-4000-8000-000000000001",
      { paidOn: null, status: "planned", version: 1 },
      context,
    );

    expect(result).toMatchObject({ paidOn: null, status: "overdue", version: 2 });
    expect(mocks.updateCardInstallmentRecord).toHaveBeenCalledOnce();
  });
});
