// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticatePrincipalRequest: vi.fn(),
  error: vi.fn(),
  getCashFlowReport: vi.fn(),
  requestLogger: vi.fn(),
}));

vi.mock("@/features/finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/finance")>()),
  getCashFlowReport: mocks.getCashFlowReport,
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticatePrincipalRequest: mocks.authenticatePrincipalRequest,
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

import { GET } from "@/app/api/finance/cash-flow/route";

const correlationId = "33333333-3333-4333-8333-333333333333";
const owner = {
  displayName: "Yönetici",
  email: "yonetici@example.com",
  kind: "development" as const,
  permissions: [] as const,
  role: "owner" as const,
};

function request(
  query = "from=2026-09-01&to=2026-09-30&granularity=weekly",
) {
  return new NextRequest(`https://portal.example.test/api/finance/cash-flow?${query}`, {
    headers: { "x-correlation-id": correlationId },
  });
}

describe("cash flow report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue(owner);
    mocks.getCashFlowReport.mockResolvedValue({
      granularity: "weekly",
      range: { from: "2026-09-01", to: "2026-09-30" },
    });
    mocks.requestLogger.mockReturnValue({ error: mocks.error });
  });

  it("distinguishes authentication from module permission", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);

    mocks.authenticatePrincipalRequest.mockResolvedValueOnce({
      ...owner,
      permissions: ["customers.read"],
      role: "member",
    });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getCashFlowReport).not.toHaveBeenCalled();
  });

  it("returns a private, correlated report for an exact range query", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(mocks.getCashFlowReport).toHaveBeenCalledWith(
      {},
      {
        from: "2026-09-01",
        granularity: "weekly",
        to: "2026-09-30",
      },
    );
  });

  it.each([
    "",
    "from=2026-09-01&to=2026-09-30",
    "from=2026-09-01&from=2026-09-02&to=2026-09-30&granularity=weekly",
    "from=2026-09-31&to=2026-10-01&granularity=weekly",
    "from=2026-09-30&to=2026-09-01&granularity=monthly",
    "from=2026-09-01&to=2026-09-30&granularity=daily",
    "from=2026-09-01&to=2026-09-30&granularity=weekly&projectId=unexpected",
  ])("rejects a non-exact filter: %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.getCashFlowReport).not.toHaveBeenCalled();
  });

  it("redacts service failures", async () => {
    mocks.getCashFlowReport.mockRejectedValueOnce(
      new Error("database-secret-sentinel"),
    );
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sentinel");
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("sentinel");
  });
});
