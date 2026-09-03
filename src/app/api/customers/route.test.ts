// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  isAdminAuthenticated: vi.fn(),
  parseCustomer: vi.fn(),
  requestLogger: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/customers", () => ({
  createCustomer: mocks.createCustomer,
  createCustomerInputSchema: { parse: mocks.parseCustomer },
  CustomerProjectNotFoundError: class CustomerProjectNotFoundError extends Error {},
  CustomerProjectUnavailableError: class CustomerProjectUnavailableError extends Error {},
  CustomerShortCodeConflictError: class CustomerShortCodeConflictError extends Error {},
  listCustomers: vi.fn(),
}));

vi.mock("@/platform/auth/server-auth", () => ({
  isAdminAuthenticated: mocks.isAdminAuthenticated,
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

import { POST } from "@/app/api/customers/route";

const correlationId = "22222222-2222-4222-8222-222222222222";
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
    mocks.isAdminAuthenticated.mockReturnValue(true);
    mocks.parseCustomer.mockReturnValue(input);
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
});
