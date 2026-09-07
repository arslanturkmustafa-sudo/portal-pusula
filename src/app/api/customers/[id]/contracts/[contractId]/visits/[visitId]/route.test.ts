// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class ContractClosedError extends Error {}
  class ContractResourceNotFoundError extends Error {}
  class MonthOutsideContractError extends Error {}
  class VisitLockedError extends Error {}
  return {
    authenticateAdminRequest: vi.fn(),
    ContractClosedError,
    ContractResourceNotFoundError,
    MonthOutsideContractError,
    parseInput: vi.fn(),
    updateMonthlyVisitWithWorkItems: vi.fn(),
    VisitLockedError,
  };
});

vi.mock("@/features/contracts", () => ({
  ContractClosedError: mocks.ContractClosedError,
  ContractResourceNotFoundError: mocks.ContractResourceNotFoundError,
  MonthOutsideContractError: mocks.MonthOutsideContractError,
  updateMonthlyVisitWithWorkItems: mocks.updateMonthlyVisitWithWorkItems,
  updateVisitWithWorkItemsInputSchema: { parse: mocks.parseInput },
  VisitLockedError: mocks.VisitLockedError,
}));

vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
}));

vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));

vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { PATCH } from "@/app/api/customers/[id]/contracts/[contractId]/visits/[visitId]/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const contractId = "30000000-0000-4000-8000-000000000001";
const visitId = "40000000-0000-4000-8000-000000000001";
const input = {
  deliveredOn: "2026-09-03",
  resolutionNote: "Saha çalışması tamamlandı",
  resolutionStatus: "completed" as const,
  workItems: ["Süreç akışı çıkarıldı", "Riskler paylaşıldı"],
};
const result = {
  tasks: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      status: "done",
      title: input.workItems[0],
    },
    {
      id: "50000000-0000-4000-8000-000000000002",
      status: "done",
      title: input.workItems[1],
    },
  ],
  visit: { id: visitId, resolutionStatus: "completed" },
};

function request(origin = "https://portal.example.test") {
  return new NextRequest(
    `https://portal.example.test/api/customers/${customerId}/contracts/${contractId}/visits/${visitId}`,
    {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        origin,
        "x-correlation-id": "60000000-0000-4000-8000-000000000001",
      },
      method: "PATCH",
    },
  );
}

const context = {
  params: Promise.resolve({ contractId, id: customerId, visitId }),
};

describe("visit work item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue({
      accountId,
      kind: "account",
      permissions: ["visits.write", "tasks.write"],
      role: "member",
    });
    mocks.parseInput.mockImplementation((value: unknown) => value);
    mocks.updateMonthlyVisitWithWorkItems.mockResolvedValue(result);
  });

  it("requires tasks.write only when completed work items are supplied", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      accountId,
      kind: "account",
      permissions: ["visits.write"],
      role: "member",
    });

    const forbiddenResponse = await PATCH(request(), context);
    expect(forbiddenResponse.status).toBe(403);
    await expect(forbiddenResponse.json()).resolves.toEqual({
      status: "forbidden",
    });
    expect(mocks.updateMonthlyVisitWithWorkItems).not.toHaveBeenCalled();

    mocks.parseInput.mockReturnValueOnce({ ...input, workItems: [] });
    mocks.updateMonthlyVisitWithWorkItems.mockResolvedValueOnce({
      tasks: [],
      visit: result.visit,
    });
    const visitOnlyResponse = await PATCH(request(), context);
    expect(visitOnlyResponse.status).toBe(200);
    expect(mocks.updateMonthlyVisitWithWorkItems).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      contractId,
      visitId,
      { ...input, workItems: [] },
      expect.anything(),
    );
  });

  it("completes the visit and returns its linked completed tasks", async () => {
    const response = await PATCH(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      createdTaskCount: 2,
      visit: result.visit,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "visits.write",
    );
    expect(mocks.updateMonthlyVisitWithWorkItems).toHaveBeenCalledWith(
      {},
      customerId,
      contractId,
      visitId,
      input,
      {
        actorId: accountId,
        correlationId: "60000000-0000-4000-8000-000000000001",
      },
    );
  });

  it("rejects unauthenticated and cross-origin requests before mutation", async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce(null);
    expect((await PATCH(request(), context)).status).toBe(401);

    mocks.authenticateAdminRequest.mockResolvedValueOnce({
      accountId,
      kind: "account",
      permissions: ["visits.write", "tasks.write"],
      role: "member",
    });
    expect(
      (await PATCH(request("https://attacker.example"), context)).status,
    ).toBe(403);
    expect(mocks.updateMonthlyVisitWithWorkItems).not.toHaveBeenCalled();
  });

  it("does not disclose service errors", async () => {
    mocks.updateMonthlyVisitWithWorkItems.mockRejectedValue({
      message: "database-message-sentinel",
      sql: "database-sql-sentinel",
    });

    const response = await PATCH(request(), context);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "service_unavailable" });
    expect(body).not.toContain("sentinel");
  });
});
