// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  hasPermission: vi.fn(),
  list: vi.fn(),
  parseCreate: vi.fn(),
  parseFilters: vi.fn(),
  requestLogger: vi.fn(),
}));
vi.mock("@/features/finance", () => ({
  createTaxObligation: mocks.create,
  createTaxObligationInputSchema: { parse: mocks.parseCreate },
  listTaxesOverview: mocks.list,
  TaxObligationIdempotencyConflictError: class extends Error {},
  TaxObligationPeriodConflictError: class extends Error {},
  taxListFilterSchema: { parse: mocks.parseFilters },
  TaxPaymentDateInFutureError: class extends Error {},
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

describe("tax API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(principal);
    mocks.hasPermission.mockReturnValue(true);
    mocks.parseFilters.mockImplementation((value: unknown) => value);
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.list.mockResolvedValue({ selectedPeriodMonth: "2026-08" });
    mocks.create.mockResolvedValue({ created: true, tax: { id: "tax-id" } });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("returns a no-store period overview for a finance reader", async () => {
    const response = await GET(
      new NextRequest(
        "https://portal.example/api/finance/taxes?periodMonth=2026-08",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "finance.taxes.read",
    );
    expect(mocks.list).toHaveBeenCalledWith({}, { periodMonth: "2026-08" });
  });

  it("creates a same-origin record with the authenticated actor", async () => {
    const body = {
      clientOperationKey: "10000000-0000-4000-8000-000000000002",
      taxType: "vat",
    };
    const response = await POST(
      new NextRequest("https://portal.example/api/finance/taxes", {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin: "https://portal.example",
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "finance.taxes.write",
    );
    expect(mocks.create).toHaveBeenCalledWith(
      {},
      body,
      expect.objectContaining({ actorId: principal.accountId }),
    );
  });

  it("rejects unauthenticated reads and cross-origin writes", async () => {
    mocks.authenticate.mockResolvedValueOnce(false);
    await expect(
      GET(new NextRequest("https://portal.example/api/finance/taxes")),
    ).resolves.toMatchObject({ status: 401 });

    const response = await POST(
      new NextRequest("https://portal.example/api/finance/taxes", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.parseCreate).not.toHaveBeenCalled();
  });
});
