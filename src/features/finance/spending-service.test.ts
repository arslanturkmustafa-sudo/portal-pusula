// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  createFinanceTransactionInConnection: vi.fn(),
  deletePlannedExpenseInstallments: vi.fn(),
  findCardInstallmentForUpdate: vi.fn(),
  findCreditCardForUpdate: vi.fn(),
  findActiveExpenseCategoryByCodeForUpdate: vi.fn(),
  findExpenseByOperationKeyForUpdate: vi.fn(),
  findExpenseForUpdate: vi.fn(),
  findFinanceAccountForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  insertCardInstallmentRecords: vi.fn(),
  insertCreditCardRecordIdempotently: vi.fn(),
  insertExpenseRecordIdempotently: vi.fn(),
  listCardInstallmentRecords: vi.fn(),
  listCardInstallmentsForBulkUpdate: vi.fn(),
  listCreditCardRecords: vi.fn(),
  listExpenseInstallmentsForUpdate: vi.fn(),
  listExpenseRecords: vi.fn(),
  reverseFinanceTransactionInConnection: vi.fn(),
  updateCardInstallmentRecord: vi.fn(),
  updateCreditCardRecord: vi.fn(),
  updateExpenseRecord: vi.fn(),
}));

vi.mock("@/features/finance/account-service", () => ({
  createFinanceTransactionInConnection:
    mocks.createFinanceTransactionInConnection,
  FinanceAccountInactiveError: class FinanceAccountInactiveError extends Error {},
  FinanceAccountNotFoundError: class FinanceAccountNotFoundError extends Error {},
  reverseFinanceTransactionInConnection:
    mocks.reverseFinanceTransactionInConnection,
}));
vi.mock("@/features/finance/account-repository", () => ({
  findFinanceAccountForUpdate: mocks.findFinanceAccountForUpdate,
}));

vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
}));
vi.mock("@/features/finance/expense-category-repository", () => ({
  findActiveExpenseCategoryByCodeForUpdate:
    mocks.findActiveExpenseCategoryByCodeForUpdate,
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
  listCardInstallmentsForBulkUpdate: mocks.listCardInstallmentsForBulkUpdate,
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
  bulkPayCardInstallments,
  CardInstallmentBulkConflictError,
  createCreditCard,
  createExpense,
  ExpensePlanLockedError,
  ExpenseSourceAccountTypeError,
  listCardInstallments,
  listExpenses,
  SpendingResourceNotFoundError,
  updateCardInstallment,
  updateExpense,
  voidExpense,
} from "@/features/finance/spending-service";
import { FinanceAccountInactiveError } from "@/features/finance/account-service";

const cardId = "20000000-0000-4000-8000-000000000001";
const expenseId = "30000000-0000-4000-8000-000000000001";
const projectId = "40000000-0000-4000-8000-000000000001";
const operationKey = "50000000-0000-4000-8000-000000000001";
const cashAccountId = "70000000-0000-4000-8000-000000000001";
const financeTransactionId = "80000000-0000-4000-8000-000000000001";
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
  financeTransactionId: null,
  netAmount: "100.0000",
  note: null,
  paymentMethod: "credit_card" as const,
  projectId,
  projectName: "ByPusula",
  projectShortCode: "BYPUSULA",
  sourceAccountId: null,
  sourceAccountName: null,
  sourceAccountType: null,
  status: "active" as const,
  totalAmount: "120.0000",
  updatedAtUtc: nowSql,
  vatAmount: "20.0000",
  vendorName: "Örnek Teknoloji",
  version: 1,
  voidedAtUtc: null,
  voidReason: null,
};

const installment = {
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
  status: "planned" as const,
  updatedAtUtc: nowSql,
  version: 1,
};

const cashAccount = {
  accountType: "cash" as const,
  bankName: null,
  clientOperationKey: "90000000-0000-4000-8000-000000000001",
  createdAtUtc: nowSql,
  currency: "TRY" as const,
  displayName: "Merkez kasa",
  id: cashAccountId,
  openingBalanceAmount: "1000.0000",
  status: "active" as const,
  updatedAtUtc: nowSql,
  version: 1,
};

describe("spending service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCreditCardForUpdate.mockResolvedValue(card);
    mocks.findActiveExpenseCategoryByCodeForUpdate.mockResolvedValue({
      code: "software_subscription",
      status: "active",
    });
    mocks.findExpenseByOperationKeyForUpdate.mockResolvedValue(null);
    mocks.findFinanceAccountForUpdate.mockResolvedValue(cashAccount);
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
    mocks.createFinanceTransactionInConnection.mockResolvedValue({
      created: true,
      transaction: { id: financeTransactionId },
    });
    mocks.listExpenseInstallmentsForUpdate.mockResolvedValue([]);
    mocks.listCardInstallmentsForBulkUpdate.mockResolvedValue([]);
    mocks.updateCardInstallmentRecord.mockResolvedValue(true);
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
        sourceAccountId: null,
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

  it("records a cash expense against the explicitly selected cash account", async () => {
    const result = await createExpense(
      {} as Pool,
      {
        category: expense.category,
        clientOperationKey: operationKey,
        creditCardId: null,
        description: "Kırtasiye ödemesi",
        documentNumber: null,
        documentType: "none",
        incurredOn: "2026-09-03",
        installmentCount: 1,
        netAmount: "100",
        note: null,
        paymentMethod: "cash",
        projectId: null,
        sourceAccountId: cashAccountId,
        vatAmount: "20",
        vendorName: null,
      },
      { ...context, canMutateAccountLedger: true },
    );

    expect(result.expense).toMatchObject({
      financeTransactionId,
      sourceAccountId: cashAccountId,
      sourceAccountName: "Merkez kasa",
      totalAmount: "120.0000",
    });
    expect(mocks.createFinanceTransactionInConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: "120.0000",
        sourceAccountId: cashAccountId,
        transactionType: "expense",
      }),
      expect.objectContaining({ canMutateAccountLedger: true }),
    );
  });

  it("replays a cash expense without appending a second movement", async () => {
    const replay = {
      ...expense,
      creditCardId: null,
      creditCardName: null,
      financeTransactionId,
      incurredOn: "2026-09-03",
      installmentCount: 1,
      paymentMethod: "cash" as const,
      projectId: null,
      projectName: null,
      projectShortCode: null,
      sourceAccountId: cashAccountId,
      sourceAccountName: "Merkez kasa",
      sourceAccountType: "cash" as const,
    };
    mocks.findExpenseByOperationKeyForUpdate.mockResolvedValue(replay);

    const result = await createExpense(
      {} as Pool,
      {
        category: replay.category,
        clientOperationKey: operationKey,
        creditCardId: null,
        description: replay.description,
        documentNumber: replay.documentNumber,
        documentType: replay.documentType,
        incurredOn: replay.incurredOn,
        installmentCount: 1,
        netAmount: replay.netAmount,
        note: replay.note,
        paymentMethod: "cash",
        projectId: null,
        sourceAccountId: cashAccountId,
        vatAmount: replay.vatAmount,
        vendorName: replay.vendorName,
      },
      { ...context, canMutateAccountLedger: true },
    );

    expect(result.created).toBe(false);
    expect(mocks.createFinanceTransactionInConnection).not.toHaveBeenCalled();
  });

  it("rejects a bank account selected for a cash expense", async () => {
    mocks.findFinanceAccountForUpdate.mockResolvedValue({
      ...cashAccount,
      accountType: "bank",
    });
    await expect(
      createExpense(
        {} as Pool,
        {
          category: expense.category,
          clientOperationKey: operationKey,
          creditCardId: null,
          description: "Kırtasiye ödemesi",
          documentNumber: null,
          documentType: "none",
          incurredOn: "2026-09-03",
          installmentCount: 1,
          netAmount: "100",
          note: null,
          paymentMethod: "cash",
          projectId: null,
          sourceAccountId: cashAccountId,
          vatAmount: "20",
          vendorName: null,
        },
        { ...context, canMutateAccountLedger: true },
      ),
    ).rejects.toBeInstanceOf(ExpenseSourceAccountTypeError);
    expect(mocks.createFinanceTransactionInConnection).not.toHaveBeenCalled();
  });

  it("rejects an inactive source account", async () => {
    mocks.findFinanceAccountForUpdate.mockResolvedValue({
      ...cashAccount,
      status: "inactive",
    });
    await expect(
      createExpense(
        {} as Pool,
        {
          category: expense.category,
          clientOperationKey: operationKey,
          creditCardId: null,
          description: "Kırtasiye ödemesi",
          documentNumber: null,
          documentType: "none",
          incurredOn: "2026-09-03",
          installmentCount: 1,
          netAmount: "100",
          note: null,
          paymentMethod: "cash",
          projectId: null,
          sourceAccountId: cashAccountId,
          vatAmount: "20",
          vendorName: null,
        },
        { ...context, canMutateAccountLedger: true },
      ),
    ).rejects.toBeInstanceOf(FinanceAccountInactiveError);
  });

  it("reverses the linked cash movement when the expense is voided", async () => {
    const linkedCashExpense = {
      ...expense,
      creditCardId: null,
      creditCardName: null,
      financeTransactionId,
      installmentCount: 1,
      paymentMethod: "cash" as const,
      sourceAccountId: cashAccountId,
      sourceAccountName: "Merkez kasa",
      sourceAccountType: "cash" as const,
    };
    mocks.findExpenseForUpdate
      .mockResolvedValueOnce(linkedCashExpense)
      .mockResolvedValueOnce({
        ...linkedCashExpense,
        status: "voided",
        version: 2,
        voidedAtUtc: nowSql,
        voidReason: "Mükerrer kayıt",
      });

    await voidExpense(
      {} as Pool,
      expenseId,
      { status: "voided", version: 1, voidReason: "Mükerrer kayıt" },
      { ...context, canMutateAccountLedger: true },
    );

    expect(mocks.reverseFinanceTransactionInConnection).toHaveBeenCalledWith(
      expect.anything(),
      financeTransactionId,
      expect.objectContaining({ reason: "Gider iptali: Mükerrer kayıt" }),
      expect.anything(),
      { allowExpenseManaged: true, preserveOriginalDate: false },
    );
    expect(mocks.updateExpenseRecord).toHaveBeenCalledOnce();
  });

  it("replaces a corrected cash movement on the original accounting date", async () => {
    const linkedCashExpense = {
      ...expense,
      creditCardId: null,
      creditCardName: null,
      financeTransactionId,
      incurredOn: "2026-09-03",
      installmentCount: 1,
      paymentMethod: "cash" as const,
      sourceAccountId: cashAccountId,
      sourceAccountName: "Merkez kasa",
      sourceAccountType: "cash" as const,
    };
    mocks.findExpenseForUpdate
      .mockResolvedValueOnce(linkedCashExpense)
      .mockResolvedValueOnce({
        ...linkedCashExpense,
        netAmount: "110.0000",
        totalAmount: "130.0000",
        version: 2,
      });

    await updateExpense(
      {} as Pool,
      expenseId,
      {
        category: linkedCashExpense.category,
        creditCardId: null,
        description: linkedCashExpense.description,
        documentNumber: linkedCashExpense.documentNumber,
        documentType: linkedCashExpense.documentType,
        incurredOn: linkedCashExpense.incurredOn,
        installmentCount: 1,
        netAmount: "110",
        note: linkedCashExpense.note,
        paymentMethod: "cash",
        projectId: linkedCashExpense.projectId,
        sourceAccountId: cashAccountId,
        status: "active",
        vatAmount: "20",
        vendorName: linkedCashExpense.vendorName,
        version: 1,
        voidReason: null,
      },
      { ...context, canMutateAccountLedger: true },
    );

    expect(mocks.reverseFinanceTransactionInConnection).toHaveBeenCalledWith(
      expect.anything(),
      financeTransactionId,
      expect.anything(),
      expect.anything(),
      { allowExpenseManaged: true, preserveOriginalDate: true },
    );
    expect(mocks.createFinanceTransactionInConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: "130.0000", occurredOn: "2026-09-03" }),
      expect.anything(),
    );
  });

  it("rejects an unknown or inactive expense category before persistence", async () => {
    mocks.findActiveExpenseCategoryByCodeForUpdate.mockResolvedValueOnce(null);
    await expect(
      createExpense(
        {} as Pool,
        {
          category: "custom_missing",
          clientOperationKey: operationKey,
          creditCardId: null,
          description: "Geçersiz kategori denemesi",
          documentNumber: null,
          documentType: "none",
          incurredOn: "2026-09-03",
          installmentCount: 1,
          netAmount: "100",
          note: null,
          paymentMethod: "cash",
          projectId: null,
          sourceAccountId: "70000000-0000-4000-8000-000000000001",
          vatAmount: "20",
          vendorName: null,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(SpendingResourceNotFoundError);
    expect(mocks.insertExpenseRecordIdempotently).not.toHaveBeenCalled();
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
          sourceAccountId: null,
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
    mocks.listCardInstallmentRecords.mockResolvedValue([installment]);
    const result = await listCardInstallments({} as Pool, {}, now);
    expect(result.installments[0]?.status).toBe("overdue");
    expect(result.summary).toMatchObject({
      openAmount: "40.0000",
      overdueAmount: "40.0000",
    });
    expect(result.cardSummaries).toEqual([
      expect.objectContaining({
        cardId,
        nextDueOn: null,
        overdueAmount: "40.0000",
        paidAmount: "0.0000",
        remainingAmount: "40.0000",
        totalAmount: "40.0000",
      }),
    ]);
  });

  it("preserves the open-only filter while deriving overdue status", async () => {
    mocks.listCardInstallmentRecords.mockResolvedValue([installment]);

    const result = await listCardInstallments(
      {} as Pool,
      { status: "open" },
      now,
    );

    expect(mocks.listCardInstallmentRecords).toHaveBeenCalledWith(
      expect.anything(),
      { status: "open" },
    );
    expect(result.installments).toEqual([
      expect.objectContaining({ id: installment.id, status: "overdue" }),
    ]);
  });

  it("summarizes paid, remaining, overdue, and the nearest upcoming card due", async () => {
    mocks.listCardInstallmentRecords.mockResolvedValue([
      { ...installment, dueOn: "2026-09-02" },
      {
        ...installment,
        amount: "30.0000",
        dueOn: "2026-09-10",
        id: "60000000-0000-4000-8000-000000000002",
        installmentNumber: 2,
      },
      {
        ...installment,
        amount: "20.0000",
        dueOn: "2026-09-10",
        id: "60000000-0000-4000-8000-000000000003",
        installmentNumber: 3,
      },
      {
        ...installment,
        amount: "10.0000",
        id: "60000000-0000-4000-8000-000000000004",
        paidOn: "2026-09-01",
        status: "paid",
      },
    ]);

    const result = await listCardInstallments({} as Pool, {}, now);

    expect(result.cardSummaries).toEqual([
      {
        cardId,
        creditCardName: card.displayName,
        nextDueAmount: "50.0000",
        nextDueOn: "2026-09-10",
        overdueAmount: "40.0000",
        paidAmount: "10.0000",
        remainingAmount: "90.0000",
        totalAmount: "100.0000",
      },
    ]);
  });

  it("bulk-pays the exact open snapshot in repository lock order with audit", async () => {
    const second = {
      ...installment,
      amount: "30.0000",
      dueOn: "2026-09-10",
      id: "60000000-0000-4000-8000-000000000002",
      installmentNumber: 2,
      version: 2,
    };
    mocks.listCardInstallmentsForBulkUpdate.mockResolvedValue([
      installment,
      second,
    ]);

    const result = await bulkPayCardInstallments(
      {} as Pool,
      {
        cardId,
        installments: [
          { id: installment.id, version: 1 },
          { id: second.id, version: 2 },
        ],
        month: "2026-09",
        paidOn: "2026-09-03",
      },
      context,
    );

    expect(mocks.findCreditCardForUpdate).toHaveBeenCalledBefore(
      mocks.listCardInstallmentsForBulkUpdate,
    );
    expect(mocks.listCardInstallmentsForBulkUpdate).toHaveBeenCalledWith(
      expect.anything(),
      cardId,
      "2026-09",
    );
    expect(mocks.updateCardInstallmentRecord).toHaveBeenCalledTimes(2);
    expect(mocks.updateCardInstallmentRecord.mock.calls.map((call) => call[1].id)).toEqual([
      installment.id,
      second.id,
    ]);
    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ replayed: false, updatedCount: 2 });
    expect(result.installments.every((item) => item.status === "paid")).toBe(true);
  });

  it("rejects a stale or incomplete bulk snapshot before changing any row", async () => {
    mocks.listCardInstallmentsForBulkUpdate.mockResolvedValue([
      installment,
      {
        ...installment,
        id: "60000000-0000-4000-8000-000000000002",
        installmentNumber: 2,
      },
    ]);

    await expect(
      bulkPayCardInstallments(
        {} as Pool,
        {
          cardId,
          installments: [{ id: installment.id, version: 1 }],
          month: "2026-09",
          paidOn: "2026-09-03",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CardInstallmentBulkConflictError);
    expect(mocks.updateCardInstallmentRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("treats an exact bulk-payment retry as a no-op without duplicate audit", async () => {
    mocks.listCardInstallmentsForBulkUpdate.mockResolvedValue([
      {
        ...installment,
        paidOn: "2026-09-03",
        status: "paid",
        version: 2,
      },
    ]);

    const result = await bulkPayCardInstallments(
      {} as Pool,
      {
        cardId,
        installments: [{ id: installment.id, version: 1 }],
        month: "2026-09",
        paidOn: "2026-09-03",
      },
      context,
    );

    expect(result).toMatchObject({ replayed: true, updatedCount: 0 });
    expect(mocks.updateCardInstallmentRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
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
