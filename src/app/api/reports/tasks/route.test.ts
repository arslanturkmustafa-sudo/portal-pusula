// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class TaskReportCustomerNotFoundError extends Error {}
  class TaskReportTooLargeError extends Error {}
  return {
    authenticatePrincipalRequest: vi.fn(),
    error: vi.fn(),
    getCustomerTaskReport: vi.fn(),
    requestLogger: vi.fn(),
    TaskReportCustomerNotFoundError,
    TaskReportTooLargeError,
  };
});

vi.mock("@/features/task-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/task-reports")>()),
  getCustomerTaskReport: mocks.getCustomerTaskReport,
  TaskReportCustomerNotFoundError: mocks.TaskReportCustomerNotFoundError,
  TaskReportTooLargeError: mocks.TaskReportTooLargeError,
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

import { GET } from "@/app/api/reports/tasks/route";

const customerId = "10000000-0000-4000-8000-000000000001";
const correlationId = "44444444-4444-4444-8444-444444444444";
const owner = {
  displayName: "Yönetici",
  email: "yonetici@example.com",
  kind: "development" as const,
  permissions: [] as const,
  role: "owner" as const,
};

function request(query = `customerId=${customerId}`) {
  return new NextRequest(`https://portal.example.test/api/reports/tasks?${query}`, {
    headers: { "x-correlation-id": correlationId },
  });
}

describe("customer task report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue(owner);
    mocks.getCustomerTaskReport.mockResolvedValue({ customer: { id: customerId } });
    mocks.requestLogger.mockReturnValue({ error: mocks.error });
  });

  it("enforces the dedicated export permission", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValueOnce({
      ...owner,
      permissions: ["tasks.read"],
      role: "member",
    });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getCustomerTaskReport).not.toHaveBeenCalled();
  });

  it("returns a no-store, correlated report without finance fields", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(JSON.stringify(body)).not.toMatch(/monthlyFee|amount|finance/iu);
  });

  it.each([
    "",
    `customerId=${customerId}&customerId=${customerId}`,
    `customerId=${customerId}&secret=unexpected`,
    `customerId=${customerId}&from=2026-09-01`,
  ])("rejects a non-exact filter: %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
  });

  it("maps report size and database errors without leaking details", async () => {
    mocks.getCustomerTaskReport.mockRejectedValueOnce(
      new mocks.TaskReportTooLargeError(),
    );
    expect((await GET(request())).status).toBe(422);

    mocks.getCustomerTaskReport.mockRejectedValueOnce({
      code: "ER_NO_SUCH_TABLE",
      message: "secret-sentinel",
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sentinel");
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("sentinel");
  });
});
