// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AuditHistoryForbiddenError: class AuditHistoryForbiddenError extends Error {},
  authenticatePrincipalRequest: vi.fn(),
  error: vi.fn(),
  getAuditHistory: vi.fn(),
  requestLogger: vi.fn(),
}));

vi.mock("@/features/audit-history", () => {
  const allowed = new Set([
    "consulting_contract",
    "customer",
    "expense",
    "finance_account",
    "finance_transaction",
    "partnership_contribution",
    "partnership_contribution_receipt",
    "partnership_commission",
    "project",
    "receivable",
    "receivable_collection",
    "work_task",
  ]);
  return {
    AuditHistoryForbiddenError: mocks.AuditHistoryForbiddenError,
    getAuditHistory: mocks.getAuditHistory,
    isAuditEntityType: (value: string) => allowed.has(value),
  };
});

vi.mock("@/platform/auth/server-auth", () => ({
  authenticatePrincipalRequest: mocks.authenticatePrincipalRequest,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: vi.fn(() => ({})),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: vi.fn(() => ({})),
}));
vi.mock("@/platform/logging/logger", () => ({
  requestLogger: mocks.requestLogger,
}));

import { GET } from "./route";

const entityId = "10000000-0000-4000-8000-000000000001";
const correlationId = "20000000-0000-4000-8000-000000000001";

function request(query = `entityType=customer&entityId=${entityId}`) {
  return new NextRequest(`https://portal.example.test/api/audit?${query}`, {
    headers: { "x-correlation-id": correlationId },
  });
}

describe("GET /api/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue({
      displayName: "Yönetici",
      email: "owner@example.test",
      kind: "development",
      permissions: [],
      role: "owner",
    });
    mocks.getAuditHistory.mockResolvedValue([]);
    mocks.requestLogger.mockReturnValue({ error: mocks.error });
  });

  it("returns 401 before reading filters for an anonymous request", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValueOnce(null);
    const response = await GET(request("token=sentinel-token"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getAuditHistory).not.toHaveBeenCalled();
  });

  it("rejects unknown, duplicate and invalid filters", async () => {
    await expect(GET(request("entityType=secret&entityId=x"))).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      GET(request(`entityType=customer&entityType=project&entityId=${entityId}`)),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      GET(request(`entityType=customer&entityId=${entityId}&extra=1`)),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("returns redacted events with no-store headers", async () => {
    mocks.getAuditHistory.mockResolvedValueOnce([
      {
        action: "archive",
        actorLabel: "Ayşe",
        after: { status: "archived" },
        before: { status: "active" },
        id: "30000000-0000-4000-8000-000000000001",
        occurredAtUtc: "2026-09-04T08:00:00.000Z",
      },
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    await expect(response.json()).resolves.toEqual({
      events: [expect.objectContaining({ action: "archive" })],
    });
  });

  it("returns 403 without leaking permission details", async () => {
    mocks.getAuditHistory.mockRejectedValueOnce(
      new mocks.AuditHistoryForbiddenError(),
    );
    const response = await GET(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ status: "forbidden" });
  });

  it("returns a generic 403 for finance audit without finance read access", async () => {
    mocks.getAuditHistory.mockRejectedValueOnce(
      new mocks.AuditHistoryForbiddenError(),
    );
    const response = await GET(
      request(`entityType=finance_transaction&entityId=${entityId}`),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ status: "forbidden" });
  });

  it("does not leak database error details", async () => {
    mocks.getAuditHistory.mockRejectedValueOnce({
      code: "ER_ACCESS_DENIED_ERROR",
      message: "sentinel-password",
      sql: "sentinel-query",
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sentinel");
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("sentinel");
  });
});
