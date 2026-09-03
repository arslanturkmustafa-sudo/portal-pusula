// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  list: vi.fn(),
  parseFilters: vi.fn(),
}));

vi.mock("@/features/finance", () => ({
  financeReceivableListFilterSchema: { parse: mocks.parseFilters },
  listFinanceReceivables: mocks.list,
}));
vi.mock("@/platform/auth/server-auth", () => ({
  isAdminAuthenticated: mocks.authenticate,
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
    mocks.authenticate.mockResolvedValue(true);
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
});
