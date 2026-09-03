// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  parseCreate: vi.fn(),
  parseFilters: vi.fn(),
  requestLogger: vi.fn(),
}));
vi.mock("@/features/finance", () => ({
  createExpense: mocks.create,
  createExpenseInputSchema: { parse: mocks.parseCreate },
  CreditCardInactiveError: class extends Error {},
  expenseListFilterSchema: { parse: mocks.parseFilters },
  listExpenses: mocks.list,
  SpendingIdempotencyConflictError: class extends Error {},
  SpendingResourceNotFoundError: class extends Error {},
}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { GET, POST } from "@/app/api/finance/expenses/route";

describe("expense collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.parseFilters.mockImplementation((value: unknown) => value);
    mocks.list.mockResolvedValue({ expenses: [], summary: {} });
    mocks.create.mockResolvedValue({ created: true, expense: { id: "expense-1" } });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("passes the supported project and month filters", async () => {
    const response = await GET(
      new NextRequest("https://portal.example/api/finance/expenses?month=2026-09&category=rent"),
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({}, { category: "rent", month: "2026-09" });
  });

  it("rejects duplicate filter keys", async () => {
    const response = await GET(
      new NextRequest("https://portal.example/api/finance/expenses?month=2026-09&month=2026-10"),
    );
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("creates an expense with its authenticated actor", async () => {
    const response = await POST(
      new NextRequest("https://portal.example/api/finance/expenses", {
        body: JSON.stringify({ description: "Kira" }),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      {},
      { description: "Kira" },
      expect.objectContaining({ actorId: "10000000-0000-4000-8000-000000000001" }),
    );
  });
});
