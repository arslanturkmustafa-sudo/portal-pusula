// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class SpendingVersionConflictError extends Error {}
  return {
    authenticate: vi.fn(),
    parse: vi.fn(),
    requestLogger: vi.fn(),
    SpendingVersionConflictError,
    update: vi.fn(),
  };
});
vi.mock("@/features/finance", () => ({
  SpendingResourceNotFoundError: class extends Error {},
  SpendingVersionConflictError: mocks.SpendingVersionConflictError,
  updateCreditCard: mocks.update,
  updateCreditCardInputSchema: { parse: mocks.parse },
}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { PATCH } from "@/app/api/finance/cards/[id]/route";

describe("credit card item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.update.mockResolvedValue({ id: "20000000-0000-4000-8000-000000000001" });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("maps an optimistic version conflict", async () => {
    mocks.update.mockRejectedValue(new mocks.SpendingVersionConflictError());
    const response = await PATCH(
      new NextRequest("https://portal.example/api/finance/cards/id", {
        body: JSON.stringify({ version: 1 }),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001" }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ status: "version_conflict" });
  });
});
