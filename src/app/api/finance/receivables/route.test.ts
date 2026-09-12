// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  hasPermission: vi.fn(),
  list: vi.fn(),
  parseFilters: vi.fn(),
}));

vi.mock("@/features/finance", () => ({
  financeReceivableListFilterSchema: { parse: mocks.parseFilters },
  listFinanceReceivables: mocks.list,
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticate,
}));
vi.mock("@/platform/auth/permissions", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { GET } from "@/app/api/finance/receivables/route";

describe("finance receivable collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "account", kind: "account" });
    mocks.hasPermission.mockReturnValue(true);
    mocks.parseFilters.mockImplementation((value: unknown) => value);
    mocks.list.mockResolvedValue({ receivables: [], summary: {} });
  });

  it("passes the supported project filter", async () => {
    const projectId = "70000000-0000-4000-8000-000000000001";
    const response = await GET(
      new NextRequest(
        `https://portal.example/api/finance/receivables?projectId=${projectId}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({}, { projectId });
  });

  it("rejects unknown and duplicate filters", async () => {
    const unknown = await GET(
      new NextRequest(
        "https://portal.example/api/finance/receivables?customerId=customer",
      ),
    );
    const duplicate = await GET(
      new NextRequest(
        "https://portal.example/api/finance/receivables?projectId=a&projectId=b",
      ),
    );

    expect(unknown.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns the safe collection movement view without caching", async () => {
    mocks.list.mockResolvedValue({
      receivables: [
        {
          collections: [
            {
              amount: "25.0000",
              collectedOn: "2026-09-02",
              entryType: "reversal",
              id: "50000000-0000-4000-8000-000000000002",
              reasonSummary: "Ters kayıt gerekçesi kaydedildi.",
              reversalOfId: "50000000-0000-4000-8000-000000000001",
              reversed: false,
            },
          ],
          id: "30000000-0000-4000-8000-000000000001",
        },
      ],
      summary: {},
    });

    const response = await GET(
      new NextRequest("https://portal.example/api/finance/receivables"),
    );
    const payload = await response.json();

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.receivables[0].collections[0]).toEqual(
      expect.objectContaining({
        entryType: "reversal",
        reasonSummary: "Ters kayıt gerekçesi kaydedildi.",
      }),
    );
    expect(payload.receivables[0].collections[0]).not.toHaveProperty(
      "clientOperationKey",
    );
  });

  it("redacts collection account details without account read permission", async () => {
    mocks.hasPermission.mockReturnValue(false);
    mocks.list.mockResolvedValue({
      receivables: [{
        collections: [{
          financeTransactionId: "b0000000-0000-4000-8000-000000000001",
          hasAccountMovement: true,
          targetAccountId: "60000000-0000-4000-8000-000000000001",
          targetAccountName: "Ana TL Hesabı",
        }],
        id: "30000000-0000-4000-8000-000000000001",
      }],
      summary: {},
    });

    const response = await GET(
      new NextRequest("https://portal.example/api/finance/receivables"),
    );
    const movement = (await response.json()).receivables[0].collections[0];

    expect(movement).toMatchObject({
      financeTransactionId: null,
      hasAccountMovement: true,
      targetAccountId: null,
      targetAccountName: null,
    });
  });
});
