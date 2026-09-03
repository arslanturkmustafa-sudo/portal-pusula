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
  createContributionInputSchema: { parse: mocks.parseCreate },
  createPartnershipContribution: mocks.create,
  listPartnershipContributions: mocks.list,
  partnershipListFilterSchema: { parse: mocks.parseFilters },
  PartnershipContributionMonthConflictError: class extends Error {},
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

describe("partnership contribution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.parseFilters.mockImplementation((value: unknown) => value);
    mocks.list.mockResolvedValue({ contributions: [], summary: {} });
    mocks.create.mockResolvedValue({ contribution: { id: "contribution-1" }, created: true });
  });

  it("lists records under authentication", async () => {
    const response = await GET(new NextRequest("https://portal.example/api/finance/partnership/contributions"));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("creates a separate contribution record", async () => {
    const response = await POST(new NextRequest("https://portal.example/api/finance/partnership/contributions", {
      body: JSON.stringify({ expectedAmount: "7000" }),
      headers: { "content-type": "application/json", origin: "https://portal.example" },
      method: "POST",
    }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({}, { expectedAmount: "7000" }, expect.anything());
  });
});
