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
}));
vi.mock("@/features/partnership-finance", () => ({
  createCommissionInputSchema: { parse: mocks.parseCreate },
  createPartnershipCommission: mocks.create,
  listPartnershipCommissions: mocks.list,
  partnershipListFilterSchema: { parse: mocks.parseFilters },
  PartnershipFutureActualDateError: class extends Error {},
  PartnershipIdempotencyConflictError: class extends Error {},
  PartnershipProjectNotFoundError: class extends Error {},
  PartnershipProjectTypeError: class extends Error {},
}));
vi.mock("@/features/finance/spending-route-support", async () => {
  const { NextResponse } = await import("next/server");
  return {
    isJsonRequest: () => true,
    isSameOrigin: () => true,
    readSpendingBody: async (request: Request) => request.json(),
    spendingActorId: (principal: { accountId?: string }) => principal.accountId,
    spendingDatabasePool: () => ({}),
    spendingJson: (body: unknown, status = 200) => NextResponse.json(body, { status }),
    uniqueQuery: (request: NextRequest) => Object.fromEntries(request.nextUrl.searchParams),
  };
});
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: () => ({ error: vi.fn() }) }));

import { GET, POST } from "./route";
import { PartnershipFutureActualDateError } from "@/features/partnership-finance";

describe("partnership commission API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.parseFilters.mockImplementation((value: unknown) => value);
    mocks.list.mockResolvedValue({ commissions: [], summary: {} });
    mocks.create.mockResolvedValue({ commission: { id: "commission-1" }, created: true });
  });

  it("passes project and month filters to the service", async () => {
    const response = await GET(new NextRequest("https://portal.example/api/finance/partnership/commissions?projectId=p1&month=2026-09"));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({}, { month: "2026-09", projectId: "p1" });
  });

  it("creates with the authenticated actor and returns 201", async () => {
    const response = await POST(new NextRequest("https://portal.example/api/finance/partnership/commissions", {
      body: JSON.stringify({ description: "Kiralama" }),
      headers: { "content-type": "application/json", origin: "https://portal.example" },
      method: "POST",
    }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({}, { description: "Kiralama" }, expect.objectContaining({
      actorId: "10000000-0000-4000-8000-000000000001",
    }));
  });

  it("does not expose commission data without authentication", async () => {
    mocks.authenticate.mockResolvedValue(false);
    const response = await GET(new NextRequest("https://portal.example/api/finance/partnership/commissions"));
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns 400 for a future actual collection date", async () => {
    mocks.create.mockRejectedValue(new PartnershipFutureActualDateError());
    const response = await POST(new NextRequest("https://portal.example/api/finance/partnership/commissions", {
      body: "{}",
      headers: { "content-type": "application/json", origin: "https://portal.example" },
      method: "POST",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "future_actual_date" });
  });
});
