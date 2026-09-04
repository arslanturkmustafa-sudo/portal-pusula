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

function request(query = "month=2026-09") {
  return new NextRequest(`https://portal.example.test/api/finance/cash-flow?${query}`, {
    headers: { "x-correlation-id": correlationId },
  });
}

describe("cash flow report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue(owner);
    mocks.getCashFlowReport.mockResolvedValue({ month: "2026-09" });
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

  it("returns a private, correlated report for an exact month query", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(mocks.getCashFlowReport).toHaveBeenCalledWith({}, { month: "2026-09" });
  });

  it.each([
    "",
    "month=2026-09&month=2026-10",
    "month=2026-9",
    "month=2026-09&projectId=unexpected",
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
