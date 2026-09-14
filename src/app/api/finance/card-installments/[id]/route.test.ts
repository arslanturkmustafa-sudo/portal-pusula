// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class InstallmentPaymentDateInFutureError extends Error {}
  return { authenticate: vi.fn(), InstallmentPaymentDateInFutureError, parse: vi.fn(), requestLogger: vi.fn(), update: vi.fn() };
});
vi.mock("@/features/finance", () => ({
  CardInstallmentPaymentExceedsRemainingError: class extends Error {},
  ExpenseAccountPermissionError: class extends Error {},
  FinanceAccountInactiveError: class extends Error {},
  FinanceAccountNotFoundError: class extends Error {},
  FinanceTransactionAlreadyReversedError: class extends Error {},
  FinanceTransactionBeforeAccountOpeningError: class extends Error {},
  FinanceTransactionFutureDateError: class extends Error {},
  InstallmentPaymentDateInFutureError: mocks.InstallmentPaymentDateInFutureError,
  SpendingIdempotencyConflictError: class extends Error {},
  SpendingResourceNotFoundError: class extends Error {},
  SpendingVersionConflictError: class extends Error {},
  updateCardInstallment: mocks.update,
  updateCardInstallmentInputSchema: { parse: mocks.parse },
}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { PATCH } from "@/app/api/finance/card-installments/[id]/route";

describe("card installment item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      accountId: "10000000-0000-4000-8000-000000000001",
      kind: "account",
      permissions: [
        "finance.accounts.read",
        "finance.accounts.write",
        "finance.cards.read",
        "finance.cards.write",
      ],
      role: "member",
    });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("rejects a future paid date with a stable response", async () => {
    mocks.update.mockRejectedValue(new mocks.InstallmentPaymentDateInFutureError());
    const response = await PATCH(
      new NextRequest("https://portal.example/api/finance/card-installments/id", {
        body: JSON.stringify({
          action: "pay",
          amount: "10.0000",
          clientOperationKey: "50000000-0000-4000-8000-000000000001",
          paidOn: "2099-01-01",
          sourceAccountId: "70000000-0000-4000-8000-000000000001",
          version: 1,
        }),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "60000000-0000-4000-8000-000000000001" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: "payment_date_in_future" });
  });

  it("requires account permissions before reading an installment body", async () => {
    mocks.authenticate.mockResolvedValue({
      accountId: "10000000-0000-4000-8000-000000000001",
      kind: "account",
      permissions: ["finance.cards.read", "finance.cards.write"],
      role: "member",
    });
    const response = await PATCH(
      new NextRequest("https://portal.example/api/finance/card-installments/id", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://portal.example",
        },
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "60000000-0000-4000-8000-000000000001" }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
