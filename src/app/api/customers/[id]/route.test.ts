// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdminAuthenticated: vi.fn(),
  parseCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
const errors = vi.hoisted(() => ({
  CustomerNotFoundError: class CustomerNotFoundError extends Error {},
  CustomerProjectNotFoundError: class CustomerProjectNotFoundError extends Error {},
  CustomerProjectInUseError: class CustomerProjectInUseError extends Error {},
  CustomerProjectUnavailableError: class CustomerProjectUnavailableError extends Error {},
  CustomerProjectVersionConflictError: class CustomerProjectVersionConflictError extends Error {},
  CustomerShortCodeConflictError: class CustomerShortCodeConflictError extends Error {},
}));

vi.mock("@/features/customers", () => ({
  ...errors,
  updateCustomer: mocks.updateCustomer,
  updateCustomerInputSchema: { parse: mocks.parseCustomer },
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

import { PATCH } from "@/app/api/customers/[id]/route";

const customerId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";

function request(): NextRequest {
  return new NextRequest(
    `https://portal.example.test/api/customers/${customerId}`,
    {
      body: JSON.stringify({ projectIds: [projectId] }),
      headers: {
        "content-type": "application/json",
        origin: "https://portal.example.test",
      },
      method: "PATCH",
    },
  );
}

const context = { params: Promise.resolve({ id: customerId }) };

describe("customer project update API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminAuthenticated.mockResolvedValue(true);
    mocks.parseCustomer.mockReturnValue({ projectIds: [projectId] });
  });

  it.each([
    [new errors.CustomerProjectNotFoundError(), 404, "project_not_found"],
    [new errors.CustomerProjectUnavailableError(), 409, "project_unavailable"],
    [new errors.CustomerProjectInUseError(), 409, "project_link_in_use"],
    [
      new errors.CustomerProjectVersionConflictError(),
      409,
      "project_link_version_conflict",
    ],
  ])("maps project domain errors without leaking details", async (error, code, status) => {
    mocks.updateCustomer.mockRejectedValueOnce(error);

    const response = await PATCH(request(), context);

    expect(response.status).toBe(code);
    await expect(response.json()).resolves.toEqual({ status });
  });
});
