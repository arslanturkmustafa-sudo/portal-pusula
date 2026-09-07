// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class CardInstallmentBulkConflictError extends Error {}
  return {
    authenticate: vi.fn(),
    bulkPay: vi.fn(),
    CardInstallmentBulkConflictError,
    parse: vi.fn(),
    pool: vi.fn(),
    requestLogger: vi.fn(),
  };
});
vi.mock("@/features/finance", () => ({
  bulkPayCardInstallments: mocks.bulkPay,
  bulkPayCardInstallmentsInputSchema: { parse: mocks.parse },
  CardInstallmentBulkConflictError: mocks.CardInstallmentBulkConflictError,
  InstallmentPaymentDateInFutureError: class extends Error {},
  SpendingResourceNotFoundError: class extends Error {},
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

import { PATCH } from "@/app/api/finance/card-installments/bulk-pay/route";

const cardId = "20000000-0000-4000-8000-000000000001";
const installmentId = "60000000-0000-4000-8000-000000000001";
const input = {
  cardId,
  installments: [{ id: installmentId, version: 1 }],
  month: "2026-09",
  paidOn: "2026-09-03",
};

function request(body: unknown = input): NextRequest {
  return new NextRequest(
    "https://portal.example/api/finance/card-installments/bulk-pay",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://portal.example",
      },
      method: "PATCH",
    },
  );
}

describe("card installment bulk-payment API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      accountId: "10000000-0000-4000-8000-000000000001",
      kind: "account",
      permissions: ["finance.cards.read", "finance.cards.write"],
      role: "member",
    });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.pool.mockReturnValue({});
    mocks.bulkPay.mockResolvedValue({
      installments: [],
      replayed: false,
      updatedCount: 1,
    });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("requires read in addition to write before parsing or opening the pool", async () => {
    mocks.authenticate.mockResolvedValue({
      accountId: "10000000-0000-4000-8000-000000000001",
      kind: "account",
      permissions: ["finance.cards.write"],
      role: "member",
    });

    const response = await PATCH(request());

    expect(response.status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.bulkPay).not.toHaveBeenCalled();
  });

  it("passes the exact validated snapshot and actor to the bulk service", async () => {
    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(mocks.parse).toHaveBeenCalledWith(input);
    expect(mocks.bulkPay).toHaveBeenCalledWith(
      {},
      input,
      expect.objectContaining({
        actorId: "10000000-0000-4000-8000-000000000001",
      }),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns a stable conflict when the locked open snapshot changed", async () => {
    mocks.bulkPay.mockRejectedValue(new mocks.CardInstallmentBulkConflictError());

    const response = await PATCH(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "installment_selection_conflict",
    });
  });
});
