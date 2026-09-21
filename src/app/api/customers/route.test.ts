// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  authenticatePrincipalRequest: vi.fn(),
  parseCustomer: vi.fn(),
  listCustomers: vi.fn(),
  requestLogger: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/customers", () => ({
  createCustomer: mocks.createCustomer,
  createCustomerInputSchema: { parse: mocks.parseCustomer },
  CustomerProjectNotFoundError: class CustomerProjectNotFoundError extends Error {},
  CustomerProjectUnavailableError: class CustomerProjectUnavailableError extends Error {},
  CustomerShortCodeConflictError: class CustomerShortCodeConflictError extends Error {},
  listCustomers: mocks.listCustomers,
}));

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

import { GET, POST } from "@/app/api/customers/route";

const correlationId = "22222222-2222-4222-8222-222222222222";
const accountId = "80000000-0000-4000-8000-000000000001";
const input = {
  contactNote: null,
  displayName: "Staging Customer",
  email: null,
  phone: null,
  projectIds: ["10000000-0000-4000-8000-000000000001"],
  shortCode: "STAGING",
  status: "active",
};

function customerRequest(): NextRequest {
  return new NextRequest("https://portal.example.test/api/customers", {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example.test",
      "x-correlation-id": correlationId,
    },
    method: "POST",
  });
}

describe("customer API database diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue({
      accountId,
      displayName: "Operasyon",
      email: "operasyon@example.com",
      kind: "account",
      permissions: ["customers.write", "customers.contact.read"],
      role: "member",
    });
    mocks.parseCustomer.mockReturnValue(input);
    mocks.listCustomers.mockResolvedValue([]);
    mocks.requestLogger.mockReturnValue({ error: mocks.error });
  });

  it("logs only an allowlisted MySQL code while preserving the generic 503", async () => {
    mocks.createCustomer.mockRejectedValueOnce({
      code: "ER_NO_SUCH_TABLE",
      message: "database-message-sentinel",
      sql: "database-sql-sentinel",
    });

    const response = await POST(customerRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "service_unavailable",
    });
    expect(mocks.requestLogger).toHaveBeenCalledWith(correlationId);
    expect(mocks.createCustomer).toHaveBeenCalledWith(
      {},
      input,
      expect.objectContaining({ actorId: accountId, correlationId }),
    );
    expect(mocks.error).toHaveBeenCalledWith(
      {
        event: "customer.api.database_failed",
        method: "POST",
        mysqlErrorCode: "ER_NO_SUCH_TABLE",
        pathname: "/api/customers",
      },
      "Customer API database operation failed: ER_NO_SUCH_TABLE",
    );
    const serializedLog = JSON.stringify(mocks.error.mock.calls);
    expect(serializedLog).not.toContain("database-message-sentinel");
    expect(serializedLog).not.toContain("database-sql-sentinel");
  });

  it("requests contact, visit and billing projections only for exact grants", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValueOnce({
      displayName: "Operasyon",
      email: "operasyon@example.com",
      kind: "account",
      permissions: ["customers.read"],
      role: "member",
    });
    const restricted = await GET(
      new NextRequest("https://portal.example.test/api/customers"),
    );
    expect(restricted.status).toBe(200);
    expect(mocks.listCustomers).toHaveBeenLastCalledWith({}, {
      projectIds: null,
      includeBilling: false,
      includeContact: false,
      includeVisits: false,
    });

    mocks.authenticatePrincipalRequest.mockResolvedValueOnce({
      displayName: "Yönetici",
      email: "yonetici@example.com",
      kind: "development",
      permissions: [],
      role: "owner",
    });
    const ownerResponse = await GET(
      new NextRequest("https://portal.example.test/api/customers"),
    );
    expect(ownerResponse.status).toBe(200);
    expect(mocks.listCustomers).toHaveBeenLastCalledWith({}, {
      projectIds: null,
      includeBilling: true,
      includeContact: true,
      includeVisits: true,
    });
  });
});
