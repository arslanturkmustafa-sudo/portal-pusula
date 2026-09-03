// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  parse: vi.fn(),
  requestLogger: vi.fn(),
}));
vi.mock("@/features/finance", () => ({
  createCreditCard: mocks.create,
  createCreditCardInputSchema: { parse: mocks.parse },
  listCreditCards: mocks.list,
  SpendingIdempotencyConflictError: class extends Error {},
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
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { GET, POST } from "@/app/api/finance/cards/route";

const principal = {
  accountId: "10000000-0000-4000-8000-000000000001",
  kind: "account" as const,
};

describe("credit card collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(principal);
    mocks.list.mockResolvedValue([{ id: "card-1" }]);
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.create.mockResolvedValue({ card: { id: "card-1" }, created: true });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("lists cards and creates a same-origin idempotent card", async () => {
    const listed = await GET(new NextRequest("https://portal.example/api/finance/cards"));
    expect(await listed.json()).toEqual({ cards: [{ id: "card-1" }] });

    const created = await POST(
      new NextRequest("https://portal.example/api/finance/cards", {
        body: JSON.stringify({ displayName: "İş kartı" }),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "POST",
      }),
    );
    expect(created.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      {},
      { displayName: "İş kartı" },
      expect.objectContaining({ actorId: principal.accountId }),
    );
  });

  it("rejects a cross-origin write before parsing", async () => {
    const response = await POST(
      new NextRequest("https://portal.example/api/finance/cards", {
        body: "{}",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
