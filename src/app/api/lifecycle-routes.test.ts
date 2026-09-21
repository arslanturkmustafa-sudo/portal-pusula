// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticatePrincipalRequest: vi.fn(),
  changeContractLifecycle: vi.fn(),
  changeCustomerLifecycle: vi.fn(),
  changeProjectLifecycle: vi.fn(),
  changeTaskLifecycle: vi.fn(),
  hasPermission: vi.fn(),
  parseLifecycle: vi.fn(),
}));
const errors = vi.hoisted(() => ({
  ContractResourceNotFoundError: class ContractResourceNotFoundError extends Error {},
  ContractVersionConflictError: class ContractVersionConflictError extends Error {},
  CustomerNotFoundError: class CustomerNotFoundError extends Error {},
  CustomerVersionConflictError: class CustomerVersionConflictError extends Error {},
  LifecycleDependencyConflictError: class LifecycleDependencyConflictError extends Error {},
  LifecycleParentUnavailableError: class LifecycleParentUnavailableError extends Error {},
  LifecycleStateConflictError: class LifecycleStateConflictError extends Error {},
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  ProjectVersionConflictError: class ProjectVersionConflictError extends Error {},
  TaskNotFoundError: class TaskNotFoundError extends Error {},
  TaskVersionConflictError: class TaskVersionConflictError extends Error {},
}));

vi.mock("@/features/customers", () => ({
  changeCustomerLifecycle: mocks.changeCustomerLifecycle,
  CustomerNotFoundError: errors.CustomerNotFoundError,
  CustomerVersionConflictError: errors.CustomerVersionConflictError,
}));
vi.mock("@/features/projects", () => ({
  changeProjectLifecycle: mocks.changeProjectLifecycle,
  ProjectNotFoundError: errors.ProjectNotFoundError,
  ProjectVersionConflictError: errors.ProjectVersionConflictError,
}));
vi.mock("@/features/tasks", () => ({
  changeTaskLifecycle: mocks.changeTaskLifecycle,
  TaskNotFoundError: errors.TaskNotFoundError,
  TaskVersionConflictError: errors.TaskVersionConflictError,
}));
vi.mock("@/features/contracts", () => ({
  changeContractLifecycle: mocks.changeContractLifecycle,
  ContractResourceNotFoundError: errors.ContractResourceNotFoundError,
  ContractVersionConflictError: errors.ContractVersionConflictError,
}));
vi.mock("@/features/lifecycle", () => ({
  LifecycleDependencyConflictError: errors.LifecycleDependencyConflictError,
  lifecycleCommandInputSchema: { parse: mocks.parseLifecycle },
  LifecycleParentUnavailableError: errors.LifecycleParentUnavailableError,
  LifecycleStateConflictError: errors.LifecycleStateConflictError,
}));
vi.mock("@/platform/auth/permissions", () => ({
  hasPermission: mocks.hasPermission,
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

import { POST as postContract } from "@/app/api/customers/[id]/contracts/[contractId]/lifecycle/route";
import { POST as postCustomer } from "@/app/api/customers/[id]/lifecycle/route";
import { POST as postProject } from "@/app/api/projects/[id]/lifecycle/route";
import { POST as postTask } from "@/app/api/tasks/[id]/lifecycle/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const taskId = "40000000-0000-4000-8000-000000000001";
const contractId = "50000000-0000-4000-8000-000000000001";
const correlationId = "60000000-0000-4000-8000-000000000001";
const input = { action: "archive" as const, reason: "Tamamlandı", version: 7 };
const principal = {
  accountId,
  credentialVersion: 1,
  displayName: "Yönetici",
  email: "yonetici@example.com",
  kind: "account" as const,
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
  permissions: [],
  role: "owner" as const,
};

function request(path: string): NextRequest {
  return new NextRequest(`https://portal.example.test${path}`, {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example.test",
      "x-correlation-id": correlationId,
    },
    method: "POST",
  });
}

describe("lifecycle command routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue(principal);
    mocks.hasPermission.mockReturnValue(true);
    mocks.parseLifecycle.mockReturnValue(input);
    mocks.changeCustomerLifecycle.mockResolvedValue({ id: customerId, version: 8 });
    mocks.changeProjectLifecycle.mockResolvedValue({ id: projectId, version: 8 });
    mocks.changeTaskLifecycle.mockResolvedValue({ id: taskId, version: 8 });
    mocks.changeContractLifecycle.mockResolvedValue({ id: contractId, version: 8 });
  });

  it.each([
    {
      call: () =>
        postCustomer(request(`/api/customers/${customerId}/lifecycle`), {
          params: Promise.resolve({ id: customerId }),
        }),
      service: mocks.changeCustomerLifecycle,
      serviceIds: [customerId],
    },
    {
      call: () =>
        postProject(request(`/api/projects/${projectId}/lifecycle`), {
          params: Promise.resolve({ id: projectId }),
        }),
      service: mocks.changeProjectLifecycle,
      serviceIds: [projectId],
    },
    {
      call: () =>
        postTask(request(`/api/tasks/${taskId}/lifecycle`), {
          params: Promise.resolve({ id: taskId }),
        }),
      service: mocks.changeTaskLifecycle,
      serviceIds: [taskId],
    },
    {
      call: () =>
        postContract(
          request(
            `/api/customers/${customerId}/contracts/${contractId}/lifecycle`,
          ),
          { params: Promise.resolve({ contractId, id: customerId }) },
        ),
      service: mocks.changeContractLifecycle,
      serviceIds: [customerId, contractId],
    },
  ])("accepts a bounded account-actor command", async ({ call, service, serviceIds }) => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(service).toHaveBeenCalledWith(
      {},
      ...serviceIds,
      input,
      {
        actorId: accountId,
        correlationId,
        ...([mocks.changeProjectLifecycle, mocks.changeTaskLifecycle].includes(service)
          ? { projectIds: null } : {}),
      },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("requires an authenticated account principal for actor attribution", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValue({
      ...principal,
      accountId: undefined,
      kind: "development",
    });
    const response = await postCustomer(
      request(`/api/customers/${customerId}/lifecycle`),
      { params: Promise.resolve({ id: customerId }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.changeCustomerLifecycle).not.toHaveBeenCalled();
  });

  it.each([
    [mocks.changeCustomerLifecycle, errors.CustomerVersionConflictError],
    [mocks.changeProjectLifecycle, errors.ProjectVersionConflictError],
    [mocks.changeTaskLifecycle, errors.TaskVersionConflictError],
    [mocks.changeContractLifecycle, errors.ContractVersionConflictError],
  ])("maps stale commands to 409", async (service, ErrorType) => {
    service.mockRejectedValueOnce(new ErrorType());
    const calls = [
      () => postCustomer(request(`/api/customers/${customerId}/lifecycle`), { params: Promise.resolve({ id: customerId }) }),
      () => postProject(request(`/api/projects/${projectId}/lifecycle`), { params: Promise.resolve({ id: projectId }) }),
      () => postTask(request(`/api/tasks/${taskId}/lifecycle`), { params: Promise.resolve({ id: taskId }) }),
      () => postContract(request(`/api/customers/${customerId}/contracts/${contractId}/lifecycle`), { params: Promise.resolve({ contractId, id: customerId }) }),
    ];
    const index = [
      mocks.changeCustomerLifecycle,
      mocks.changeProjectLifecycle,
      mocks.changeTaskLifecycle,
      mocks.changeContractLifecycle,
    ].indexOf(service);
    const response = await calls[index]!();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ status: "version_conflict" });
  });
});
