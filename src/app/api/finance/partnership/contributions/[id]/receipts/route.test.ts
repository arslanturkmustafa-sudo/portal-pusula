// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("@/features/partnership-finance", () => ({
  createContributionReceiptInputSchema: { parse: mocks.parse },
  createPartnershipContributionReceipt: mocks.create,
  PartnershipContributionClosedError: class extends Error {},
  PartnershipContributionOverpaymentError: class extends Error {},
  PartnershipFutureActualDateError: class extends Error {},
  PartnershipIdempotencyConflictError: class extends Error {},
  PartnershipRecordNotFoundError: class extends Error {},
  PartnershipVersionConflictError: class extends Error {},
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
  };
});
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: () => ({ error: vi.fn() }) }));

import { POST } from "./route";
import { PartnershipFutureActualDateError } from "@/features/partnership-finance";

describe("partnership contribution receipt API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.create.mockResolvedValue({ contribution: { id: "contribution-1" }, created: true, receipt: { id: "receipt-1" } });
  });

  it("appends the authenticated receipt to the route contribution", async () => {
    const response = await POST(new NextRequest("https://portal.example/api/finance/partnership/contributions/contribution-1/receipts", {
      body: JSON.stringify({ amount: "3000" }),
      headers: { "content-type": "application/json", origin: "https://portal.example" },
      method: "POST",
    }), { params: Promise.resolve({ id: "contribution-1" }) });
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({}, "contribution-1", { amount: "3000" }, expect.objectContaining({
      actorId: "10000000-0000-4000-8000-000000000001",
    }));
  });

  it("rejects unauthenticated receipt writes", async () => {
    mocks.authenticate.mockResolvedValue(false);
    const response = await POST(new NextRequest("https://portal.example/api/finance/partnership/contributions/contribution-1/receipts", {
      body: "{}",
      headers: { "content-type": "application/json", origin: "https://portal.example" },
      method: "POST",
    }), { params: Promise.resolve({ id: "contribution-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns 400 for a future actual receipt date", async () => {
    mocks.create.mockRejectedValue(new PartnershipFutureActualDateError());
    const response = await POST(new NextRequest("https://portal.example/api/finance/partnership/contributions/contribution-1/receipts", {
      body: "{}",
      headers: { "content-type": "application/json", origin: "https://portal.example" },
      method: "POST",
    }), { params: Promise.resolve({ id: "contribution-1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "future_actual_date" });
  });
});
