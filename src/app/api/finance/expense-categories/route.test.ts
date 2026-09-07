// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  hasPermission: vi.fn(),
  list: vi.fn(),
  parse: vi.fn(),
  requestLogger: vi.fn(),
}));
vi.mock("@/features/finance", () => ({
  createExpenseCategory: mocks.create,
  createExpenseCategoryInputSchema: { parse: mocks.parse },
  ExpenseCategoryAlreadyExistsError: class extends Error {},
  ExpenseCategoryIdempotencyConflictError: class extends Error {},
  listExpenseCategories: mocks.list,
}));
vi.mock("@/platform/auth/permissions", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticate,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));
vi.mock("@/platform/logging/logger", () => ({
  requestLogger: mocks.requestLogger,
}));

import { GET, POST } from "./route";

const principal = {
  accountId: "10000000-0000-4000-8000-000000000001",
  kind: "account" as const,
};

describe("expense category API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(principal);
    mocks.hasPermission.mockReturnValue(true);
    mocks.list.mockResolvedValue({ categories: [{ code: "rent" }] });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.create.mockResolvedValue({
      category: { code: "custom_123", displayName: "Eğitim" },
      created: true,
    });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("lists categories without caching", async () => {
    const response = await GET(
      new NextRequest("https://portal.example/api/finance/expense-categories"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      categories: [{ code: "rent" }],
    });
  });

  it("creates a same-origin category with the authenticated actor", async () => {
    const response = await POST(
      new NextRequest("https://portal.example/api/finance/expense-categories", {
        body: JSON.stringify({ displayName: "Eğitim" }),
        headers: {
          "content-type": "application/json",
          origin: "https://portal.example",
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      {},
      { displayName: "Eğitim" },
      expect.objectContaining({ actorId: principal.accountId }),
    );
  });

  it("rejects cross-origin and write-only principals before parsing", async () => {
    const crossOrigin = await POST(
      new NextRequest("https://portal.example/api/finance/expense-categories", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        method: "POST",
      }),
    );
    expect(crossOrigin.status).toBe(403);

    mocks.hasPermission.mockReturnValue(false);
    const missingRead = await POST(
      new NextRequest("https://portal.example/api/finance/expense-categories", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://portal.example",
        },
        method: "POST",
      }),
    );
    expect(missingRead.status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
