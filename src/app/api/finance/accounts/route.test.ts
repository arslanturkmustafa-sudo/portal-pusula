// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createAccount: vi.fn(),
  createTransaction: vi.fn(),
  list: vi.fn(),
  logError: vi.fn(),
  parseAccount: vi.fn(),
  parseReverse: vi.fn(),
  parseTransaction: vi.fn(),
  parseUpdate: vi.fn(),
  pool: vi.fn(),
  requestLogger: vi.fn(),
  reverseTransaction: vi.fn(),
  updateAccount: vi.fn(),
}));

vi.mock("@/features/finance", () => ({
  createFinanceAccount: mocks.createAccount,
  createFinanceAccountInputSchema: { parse: mocks.parseAccount },
  createFinanceTransaction: mocks.createTransaction,
  createFinanceTransactionInputSchema: { parse: mocks.parseTransaction },
  FinanceAccountIdempotencyConflictError: class extends Error {},
  FinanceAccountInactiveError: class extends Error {},
  FinanceAccountNotFoundError: class extends Error {},
  FinanceAccountVersionConflictError: class extends Error {},
  FinanceLedgerIntegrityError: class extends Error {},
  FinanceTransactionAlreadyReversedError: class extends Error {},
  FinanceTransactionFutureDateError: class extends Error {},
  FinanceTransactionIdempotencyConflictError: class extends Error {},
  FinanceTransactionNotFoundError: class extends Error {},
  FinanceTransactionReversalNotAllowedError: class extends Error {},
  listFinanceAccountsOverview: mocks.list,
  reverseFinanceTransaction: mocks.reverseTransaction,
  reverseFinanceTransactionInputSchema: { parse: mocks.parseReverse },
  updateFinanceAccount: mocks.updateAccount,
  updateFinanceAccountInputSchema: { parse: mocks.parseUpdate },
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticate,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: mocks.pool,
}));
vi.mock("@/platform/logging/logger", () => ({
  requestLogger: mocks.requestLogger,
}));

import { POST as postTransaction } from "@/app/api/finance/account-transactions/route";
import { POST as reverseTransaction } from "@/app/api/finance/account-transactions/[id]/reverse/route";
import { GET, POST as postAccount } from "@/app/api/finance/accounts/route";
import { PATCH as patchAccount } from "@/app/api/finance/accounts/[id]/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const transactionId = "20000000-0000-4000-8000-000000000001";
const principal = {
  accountId: "30000000-0000-4000-8000-000000000001",
  credentialVersion: 1,
  displayName: "Finans kullanıcısı",
  email: "finance@example.test",
  kind: "account",
  passwordChangedAtUtc: "2026-09-01 00:00:00.000000",
  permissions: ["finance.accounts.read", "finance.accounts.write"],
  role: "member",
};

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example",
    },
    method,
  });
}

describe("finance account APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(principal);
    mocks.parseAccount.mockImplementation((value: unknown) => value);
    mocks.parseUpdate.mockImplementation((value: unknown) => value);
    mocks.parseTransaction.mockImplementation((value: unknown) => value);
    mocks.parseReverse.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: mocks.logError });
    mocks.pool.mockReturnValue({ pool: true });
    mocks.list.mockResolvedValue({ accounts: [], recentTransactions: [], summary: {} });
    mocks.createAccount.mockResolvedValue({ account: { id: accountId }, created: true });
    mocks.updateAccount.mockResolvedValue({ id: accountId, version: 2 });
    mocks.createTransaction.mockResolvedValue({
      created: true,
      transaction: { id: transactionId },
    });
    mocks.reverseTransaction.mockResolvedValue({
      created: true,
      transaction: { id: "20000000-0000-4000-8000-000000000002" },
    });
  });

  it("requires the dedicated read permission before obtaining a pool", async () => {
    const response = await GET(new NextRequest("https://portal.example/api/finance/accounts"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "finance.accounts.read",
    );
    expect(mocks.list).toHaveBeenCalledWith({ pool: true });
  });

  it("fails closed for every route before parsing or calling a service", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const responses = await Promise.all([
      GET(new NextRequest("https://portal.example/api/finance/accounts")),
      postAccount(jsonRequest("https://portal.example/api/finance/accounts", {})),
      patchAccount(
        jsonRequest(`https://portal.example/api/finance/accounts/${accountId}`, {}, "PATCH"),
        { params: Promise.resolve({ id: accountId }) },
      ),
      postTransaction(jsonRequest("https://portal.example/api/finance/account-transactions", {})),
      reverseTransaction(
        jsonRequest(
          `https://portal.example/api/finance/account-transactions/${transactionId}/reverse`,
          {},
        ),
        { params: Promise.resolve({ id: transactionId }) },
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(mocks.parseAccount).not.toHaveBeenCalled();
    expect(mocks.parseUpdate).not.toHaveBeenCalled();
    expect(mocks.parseTransaction).not.toHaveBeenCalled();
    expect(mocks.parseReverse).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.createAccount).not.toHaveBeenCalled();
  });

  it("uses only the dedicated write permission and authenticated actor for mutations", async () => {
    await postAccount(
      jsonRequest("https://portal.example/api/finance/accounts", { displayName: "Kasa" }),
    );
    await patchAccount(
      jsonRequest(
        `https://portal.example/api/finance/accounts/${accountId}`,
        { version: 1 },
        "PATCH",
      ),
      { params: Promise.resolve({ id: accountId }) },
    );
    await postTransaction(
      jsonRequest("https://portal.example/api/finance/account-transactions", {
        amount: "10",
      }),
    );
    await reverseTransaction(
      jsonRequest(
        `https://portal.example/api/finance/account-transactions/${transactionId}/reverse`,
        { reason: "Düzeltme" },
      ),
      { params: Promise.resolve({ id: transactionId }) },
    );

    expect(mocks.authenticate.mock.calls.map((call) => call[1])).toEqual([
      "finance.accounts.write",
      "finance.accounts.write",
      "finance.accounts.write",
      "finance.accounts.write",
    ]);
    expect(mocks.createAccount).toHaveBeenCalledWith(
      { pool: true },
      { displayName: "Kasa" },
      expect.objectContaining({ actorId: principal.accountId }),
    );
    expect(mocks.updateAccount).toHaveBeenCalledWith(
      { pool: true },
      accountId,
      { version: 1 },
      expect.objectContaining({ actorId: principal.accountId }),
    );
    expect(mocks.createTransaction).toHaveBeenCalledOnce();
    expect(mocks.reverseTransaction).toHaveBeenCalledOnce();
  });

  it("rejects a write-only member before body parsing or pool access", async () => {
    mocks.authenticate.mockResolvedValue({
      ...principal,
      permissions: ["finance.accounts.write"],
    });
    const responses = await Promise.all([
      postAccount(jsonRequest("https://portal.example/api/finance/accounts", {})),
      patchAccount(
        jsonRequest(`https://portal.example/api/finance/accounts/${accountId}`, {}, "PATCH"),
        { params: Promise.resolve({ id: accountId }) },
      ),
      postTransaction(jsonRequest("https://portal.example/api/finance/account-transactions", {})),
      reverseTransaction(
        jsonRequest(
          `https://portal.example/api/finance/account-transactions/${transactionId}/reverse`,
          {},
        ),
        { params: Promise.resolve({ id: transactionId }) },
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.parseAccount).not.toHaveBeenCalled();
    expect(mocks.parseUpdate).not.toHaveBeenCalled();
    expect(mocks.parseTransaction).not.toHaveBeenCalled();
    expect(mocks.parseReverse).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.createAccount).not.toHaveBeenCalled();
    expect(mocks.updateAccount).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.reverseTransaction).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation before body parsing", async () => {
    const response = await postAccount(
      new NextRequest("https://portal.example/api/finance/accounts", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.parseAccount).not.toHaveBeenCalled();
    expect(mocks.createAccount).not.toHaveBeenCalled();
  });

  it("fails closed with a generic 503 when ledger reconciliation rejects the read", async () => {
    mocks.list.mockRejectedValueOnce({
      code: "FINANCE_LEDGER_MISMATCH",
      message: "sentinel-corrupt-account",
    });
    const response = await GET(
      new NextRequest("https://portal.example/api/finance/accounts"),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sentinel");
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(
      "sentinel-corrupt-account",
    );
  });
});
