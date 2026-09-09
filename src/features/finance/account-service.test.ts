// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findAccountBalance: vi.fn(),
  findAccountByOperation: vi.fn(),
  findAccountForUpdate: vi.fn(),
  findExpenseByTransaction: vi.fn(),
  findReversal: vi.fn(),
  findTransaction: vi.fn(),
  findTransactionByOperation: vi.fn(),
  insertAccount: vi.fn(),
  insertLedger: vi.fn(),
  insertTransaction: vi.fn(),
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  lockAccounts: vi.fn(),
  updateAccount: vi.fn(),
}));

vi.mock("@/features/finance/account-repository", () => ({
  findFinanceAccountBalanceRecord: mocks.findAccountBalance,
  findFinanceAccountByOperationKeyForUpdate: mocks.findAccountByOperation,
  findFinanceAccountForUpdate: mocks.findAccountForUpdate,
  findExpenseByFinanceTransactionForUpdate: mocks.findExpenseByTransaction,
  findFinanceTransactionByOperationKeyForUpdate: mocks.findTransactionByOperation,
  findFinanceTransactionForUpdate: mocks.findTransaction,
  findFinanceTransactionReversalForUpdate: mocks.findReversal,
  insertFinanceAccountRecordIdempotently: mocks.insertAccount,
  insertFinanceLedgerEntries: mocks.insertLedger,
  insertFinanceTransactionRecordIdempotently: mocks.insertTransaction,
  listFinanceAccountBalanceRecords: mocks.listAccounts,
  listRecentFinanceTransactionRecords: mocks.listTransactions,
  lockFinanceAccounts: mocks.lockAccounts,
  updateFinanceAccountRecord: mocks.updateAccount,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcConsistentRead: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) => operation({}),
  ),
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) => operation({}),
  ),
}));

import {
  createFinanceTransaction,
  FinanceAccountInactiveError,
  FinanceTransactionBeforeAccountOpeningError,
  FinanceTransactionManagedByExpenseError,
  listFinanceAccountsOverview,
  reverseFinanceTransaction,
} from "@/features/finance/account-service";

const bankId = "10000000-0000-4000-8000-000000000001";
const cashId = "10000000-0000-4000-8000-000000000002";
const transactionId = "20000000-0000-4000-8000-000000000001";
const operationKey = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-07T09:00:00.000Z");
const nowSql = "2026-09-07 09:00:00.000000";
const context = { correlationId: "account-service-test", now };

function account(id: string, accountType: "bank" | "cash", balance: string) {
  return {
    accountType,
    balanceAmount: balance,
    bankName: accountType === "bank" ? "Örnek Banka" : null,
    clientOperationKey: operationKey,
    createdAtUtc: nowSql,
    currency: "TRY" as const,
    displayName: accountType === "bank" ? "İşletme hesabı" : "Merkez kasa",
    id,
    openingBalanceAmount: "100.0000",
    status: "active" as const,
    updatedAtUtc: nowSql,
    version: 1,
  };
}

const bank = account(bankId, "bank", "125.0000");
const cash = account(cashId, "cash", "50.0000");

describe("finance account service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTransactionByOperation.mockResolvedValue(null);
    mocks.findExpenseByTransaction.mockResolvedValue(null);
    mocks.findReversal.mockResolvedValue(null);
    mocks.lockAccounts.mockImplementation(async (_connection, ids: string[]) =>
      ids.map((id) => (id === bankId ? bank : cash)),
    );
    mocks.insertTransaction.mockImplementation(async (_connection, pending) => pending);
    mocks.listTransactions.mockResolvedValue([]);
  });

  it("derives the overview without exposing operation keys or timestamps", async () => {
    mocks.listAccounts.mockResolvedValue([bank, cash]);
    const result = await listFinanceAccountsOverview({} as Pool);
    expect(result.summary).toEqual({
      accountCount: 2,
      activeAccountCount: 2,
      bankBalanceAmount: "125.0000",
      cashBalanceAmount: "50.0000",
      currency: "TRY",
      totalLiquidBalance: "175.0000",
    });
    expect(result.accounts[0]).not.toHaveProperty("clientOperationKey");
    expect(result.accounts[0]).not.toHaveProperty("createdAtUtc");
    expect(result.accounts[0]).toHaveProperty("openedOn", "2026-09-07");
  });

  it.each(["income", "expense"] as const)(
    "rejects a backdated %s before the affected account opening",
    async (transactionType) => {
      await expect(
        createFinanceTransaction(
          {} as Pool,
          {
            amount: "25",
            clientOperationKey: operationKey,
            description: "Açılış öncesi hareket",
            occurredOn: "2026-09-06",
            sourceAccountId: transactionType === "expense" ? bankId : null,
            targetAccountId: transactionType === "income" ? bankId : null,
            transactionType,
          },
          context,
        ),
      ).rejects.toBeInstanceOf(FinanceTransactionBeforeAccountOpeningError);
      expect(mocks.insertTransaction).not.toHaveBeenCalled();
      expect(mocks.insertLedger).not.toHaveBeenCalled();
    },
  );

  it("uses the latest affected account opening as the transfer boundary", async () => {
    mocks.lockAccounts.mockResolvedValue([
      { ...bank, createdAtUtc: "2026-09-05 20:59:00.000000" },
      cash,
    ]);
    await expect(
      createFinanceTransaction(
        {} as Pool,
        {
          amount: "25",
          clientOperationKey: operationKey,
          description: "Açılış öncesi transfer",
          occurredOn: "2026-09-06",
          sourceAccountId: bankId,
          targetAccountId: cashId,
          transactionType: "transfer",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(FinanceTransactionBeforeAccountOpeningError);
    expect(mocks.insertTransaction).not.toHaveBeenCalled();
  });

  it("keeps an idempotent historical replay readable without reapplying the new rule", async () => {
    mocks.findTransactionByOperation.mockResolvedValue({
      amount: "25.0000",
      clientOperationKey: operationKey,
      createdAtUtc: nowSql,
      currency: "TRY",
      description: "Tarihsel tahsilat",
      id: transactionId,
      occurredOn: "2026-09-06",
      reversalOfId: null,
      reversalReason: null,
      sourceAccountId: null,
      targetAccountId: bankId,
      transactionType: "income",
    });

    await expect(
      createFinanceTransaction(
        {} as Pool,
        {
          amount: "25",
          clientOperationKey: operationKey,
          description: "Tarihsel tahsilat",
          occurredOn: "2026-09-06",
          sourceAccountId: null,
          targetAccountId: bankId,
          transactionType: "income",
        },
        context,
      ),
    ).resolves.toMatchObject({ created: false });
    expect(mocks.insertTransaction).not.toHaveBeenCalled();
    expect(mocks.insertLedger).not.toHaveBeenCalled();
  });

  it("records a transfer as one transaction and exactly two opposing ledger legs", async () => {
    const result = await createFinanceTransaction(
      {} as Pool,
      {
        amount: "25",
        clientOperationKey: operationKey,
        description: "Kasaya aktarım",
        occurredOn: "2026-09-07",
        sourceAccountId: bankId,
        targetAccountId: cashId,
        transactionType: "transfer",
      },
      context,
    );
    expect(result.created).toBe(true);
    expect(mocks.insertTransaction).toHaveBeenCalledOnce();
    const entries = mocks.insertLedger.mock.calls[0]?.[1];
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: bankId, amount: "25.0000", entrySide: "outflow" }),
        expect.objectContaining({ accountId: cashId, amount: "25.0000", entrySide: "inflow" }),
      ]),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledOnce();
  });

  it("rejects new activity on an inactive account before inserting the header", async () => {
    mocks.lockAccounts.mockResolvedValue([{ ...bank, status: "inactive" }]);
    await expect(
      createFinanceTransaction(
        {} as Pool,
        {
          amount: "25",
          clientOperationKey: operationKey,
          description: "Tahsilat",
          occurredOn: "2026-09-07",
          sourceAccountId: null,
          targetAccountId: bankId,
          transactionType: "income",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(FinanceAccountInactiveError);
    expect(mocks.insertTransaction).not.toHaveBeenCalled();
    expect(mocks.insertLedger).not.toHaveBeenCalled();
  });

  it("reverses an income with an immutable expense linked to the original", async () => {
    mocks.findTransaction.mockResolvedValue({
      amount: "75.0000",
      clientOperationKey: "40000000-0000-4000-8000-000000000001",
      createdAtUtc: nowSql,
      currency: "TRY",
      description: "Müşteri tahsilatı",
      id: transactionId,
      occurredOn: "2026-09-06",
      reversalOfId: null,
      reversalReason: null,
      sourceAccountId: null,
      targetAccountId: bankId,
      transactionType: "income",
    });
    const result = await reverseFinanceTransaction(
      {} as Pool,
      transactionId,
      { clientOperationKey: operationKey, reason: "Mükerrer kayıt" },
      context,
    );
    expect(result.transaction).toMatchObject({
      isReversal: true,
      sourceAccount: { id: bankId },
      targetAccount: null,
      transactionType: "expense",
    });
    expect(mocks.insertTransaction.mock.calls[0]?.[1]).toMatchObject({
      reversalOfId: transactionId,
      reversalReason: "Mükerrer kayıt",
      sourceAccountId: bankId,
      targetAccountId: null,
      transactionType: "expense",
    });
    expect(mocks.insertLedger.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ accountId: bankId, entrySide: "outflow" }),
    ]);
  });

  it("blocks a generic reversal for an expense-managed movement", async () => {
    mocks.findExpenseByTransaction.mockResolvedValue(
      "50000000-0000-4000-8000-000000000001",
    );
    await expect(
      reverseFinanceTransaction(
        {} as Pool,
        transactionId,
        { clientOperationKey: operationKey, reason: "Yanlış kayıt" },
        context,
      ),
    ).rejects.toBeInstanceOf(FinanceTransactionManagedByExpenseError);
    expect(mocks.findTransaction).not.toHaveBeenCalled();
  });
});
