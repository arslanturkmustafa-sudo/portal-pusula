// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatePrincipalRequest: vi.fn(),
  createCustomerContract: vi.fn(),
  getDatabaseProbeEnvironment: vi.fn(),
  getPlatformDatabasePool: vi.fn(),
  listCustomerContracts: vi.fn(),
}));

vi.mock("@/platform/auth/server-auth", () => ({
  authenticatePrincipalRequest: mocks.authenticatePrincipalRequest,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: mocks.getDatabaseProbeEnvironment,
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: mocks.getPlatformDatabasePool,
}));
vi.mock("@/features/contracts", () => ({
  ContractCustomerInactiveError: class ContractCustomerInactiveError extends Error {},
  ContractPeriodConflictError: class ContractPeriodConflictError extends Error {},
  ContractProjectUnavailableError: class ContractProjectUnavailableError extends Error {},
  ContractResourceNotFoundError: class ContractResourceNotFoundError extends Error {},
  createContractInputSchema: { parse: vi.fn() },
  createCustomerContract: mocks.createCustomerContract,
  listCustomerContracts: mocks.listCustomerContracts,
}));

import { GET, POST } from "@/app/api/customers/[id]/contracts/route";

const context = {
  params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }),
};
const contract = {
  createdAtUtc: "2026-09-03 10:00:00.000000",
  currency: "TRY" as const,
  customerId: "10000000-0000-4000-8000-000000000001",
  endsOn: "2027-08-31",
  id: "20000000-0000-4000-8000-000000000001",
  internalNote: "Operasyon notu",
  monthlyFeeAmount: "45000.0000",
  paymentDay: 5,
  projectId: "30000000-0000-4000-8000-000000000001",
  startsOn: "2026-09-01",
  status: "active" as const,
  updatedAtUtc: "2026-09-03 10:00:00.000000",
  vatMode: "exclusive" as const,
  vatRate: "20.00",
};

function request(method = "GET") {
  return new NextRequest(
    "https://portal.example.test/api/customers/10000000-0000-4000-8000-000000000001/contracts",
    { method },
  );
}

function principal(permissions: readonly string[]) {
  return { permissions, role: "member" };
}

describe("customer contract permission boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseProbeEnvironment.mockReturnValue({});
    mocks.getPlatformDatabasePool.mockReturnValue({});
    mocks.listCustomerContracts.mockResolvedValue([contract]);
  });

  it("distinguishes unauthenticated and forbidden reads", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(401);

    mocks.authenticatePrincipalRequest.mockResolvedValueOnce(principal([]));
    const forbidden = await GET(request(), context);
    expect(forbidden.status).toBe(403);
    expect(mocks.listCustomerContracts).not.toHaveBeenCalled();
  });

  it("returns operational contract fields without financial terms", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValue(
      principal(["contracts.read"]),
    );
    const response = await GET(request(), context);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.contracts).toEqual([
      {
        createdAtUtc: contract.createdAtUtc,
        customerId: contract.customerId,
        endsOn: contract.endsOn,
        id: contract.id,
        internalNote: contract.internalNote,
        projectId: contract.projectId,
        startsOn: contract.startsOn,
        status: contract.status,
        updatedAtUtc: contract.updatedAtUtc,
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain(contract.monthlyFeeAmount);
    expect(payload.contracts[0]).not.toHaveProperty("paymentDay");
    expect(payload.contracts[0]).not.toHaveProperty("vatMode");
  });

  it("includes financial terms only with the billing-read permission", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValue(
      principal(["contracts.read", "contracts.billing.read"]),
    );
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({ contracts: [contract] });
  });

  it("requires both operational and billing write permissions", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValue(
      principal(["contracts.write"]),
    );
    const response = await POST(request("POST"), context);
    expect(response.status).toBe(403);
    expect(mocks.createCustomerContract).not.toHaveBeenCalled();
  });
});
