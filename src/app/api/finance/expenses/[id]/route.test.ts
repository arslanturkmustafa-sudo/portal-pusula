// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class ExpensePlanLockedError extends Error {}
  return { authenticate: vi.fn(), ExpensePlanLockedError, parse: vi.fn(), requestLogger: vi.fn(), update: vi.fn() };
});
vi.mock("@/features/finance", () => ({
  CreditCardInactiveError: class extends Error {},
  ExpenseAlreadyVoidedError: class extends Error {},
  ExpensePlanLockedError: mocks.ExpensePlanLockedError,
  SpendingResourceNotFoundError: class extends Error {},
  SpendingVersionConflictError: class extends Error {},
  updateExpense: mocks.update,
  updateExpenseInputSchema: { parse: mocks.parse },
}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { PATCH } from "@/app/api/finance/expenses/[id]/route";

describe("expense item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("returns a stable conflict when a paid plan locks the expense", async () => {
    mocks.update.mockRejectedValue(new mocks.ExpensePlanLockedError());
    const response = await PATCH(
      new NextRequest("https://portal.example/api/finance/expenses/id", {
        body: JSON.stringify({ status: "voided", version: 1, voidReason: "Mükerrer" }),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "30000000-0000-4000-8000-000000000001" }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ status: "expense_plan_locked" });
  });
});
