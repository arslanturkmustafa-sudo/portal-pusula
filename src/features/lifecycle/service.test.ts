// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  contractHasLifecycleDependencies: vi.fn(),
  customerHasLifecycleDependencies: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findOwnedContractForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  findTaskStateForUpdate: vi.fn(),
  projectHasLifecycleDependencies: vi.fn(),
  updateContractRecord: vi.fn(),
  updateCustomerRecord: vi.fn(),
  updateProjectRecord: vi.fn(),
  updateTaskRecord: vi.fn(),
}));

const domainErrors = vi.hoisted(() => ({
  ContractResourceNotFoundError: class ContractResourceNotFoundError extends Error {},
  ContractVersionConflictError: class ContractVersionConflictError extends Error {},
  CustomerNotFoundError: class CustomerNotFoundError extends Error {},
  CustomerVersionConflictError: class CustomerVersionConflictError extends Error {},
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  ProjectVersionConflictError: class ProjectVersionConflictError extends Error {},
  TaskNotFoundError: class TaskNotFoundError extends Error {},
  TaskVersionConflictError: class TaskVersionConflictError extends Error {},
}));

vi.mock("@/features/customers/repository", () => ({
  customerHasLifecycleDependencies: mocks.customerHasLifecycleDependencies,
  findActiveCustomerProjectForUpdate: vi.fn(),
  findCustomerForUpdate: mocks.findCustomerForUpdate,
  updateCustomerRecord: mocks.updateCustomerRecord,
}));
vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
  projectHasLifecycleDependencies: mocks.projectHasLifecycleDependencies,
  updateProjectRecord: mocks.updateProjectRecord,
}));
vi.mock("@/features/tasks/repository", () => ({
  findTaskStateForUpdate: mocks.findTaskStateForUpdate,
  updateTaskRecord: mocks.updateTaskRecord,
}));
vi.mock("@/features/contracts/repository", () => ({
  contractHasLifecycleDependencies: mocks.contractHasLifecycleDependencies,
  findOwnedContractForUpdate: mocks.findOwnedContractForUpdate,
  updateContractRecord: mocks.updateContractRecord,
}));
vi.mock("@/features/customers/service", () => ({
  CustomerNotFoundError: domainErrors.CustomerNotFoundError,
  CustomerVersionConflictError: domainErrors.CustomerVersionConflictError,
}));
vi.mock("@/features/projects/service", () => ({
  ProjectNotFoundError: domainErrors.ProjectNotFoundError,
  ProjectVersionConflictError: domainErrors.ProjectVersionConflictError,
}));
vi.mock("@/features/tasks/service", () => ({
  TaskNotFoundError: domainErrors.TaskNotFoundError,
  TaskVersionConflictError: domainErrors.TaskVersionConflictError,
}));
vi.mock("@/features/contracts/service", () => ({
  ContractResourceNotFoundError: domainErrors.ContractResourceNotFoundError,
  ContractVersionConflictError: domainErrors.ContractVersionConflictError,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import { changeContractLifecycle } from "@/features/contracts/lifecycle-service";
import { changeCustomerLifecycle } from "@/features/customers/lifecycle-service";
import {
  LifecycleDependencyConflictError,
  LifecycleParentUnavailableError,
} from "@/features/lifecycle/errors";
import { changeProjectLifecycle } from "@/features/projects/lifecycle-service";
import { changeTaskLifecycle } from "@/features/tasks/lifecycle-service";

const actorId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const taskId = "40000000-0000-4000-8000-000000000001";
const contractId = "50000000-0000-4000-8000-000000000001";
const context = {
  actorId,
  correlationId: "lifecycle-service-test",
  now: new Date("2026-09-04T09:30:00.000Z"),
};
const archiveMetadata = {
  archiveReason: null,
  archivedAtUtc: null,
  archivedByUserAccountId: null,
  version: 3,
};
const customer = {
  ...archiveMetadata,
  contactNote: null,
  createdAtUtc: "2026-09-01 09:00:00.000000",
  displayName: "Öncü",
  email: null,
  id: customerId,
  overview: { nextVisitOn: null },
  phone: null,
  projects: [],
  shortCode: "ONCU",
  status: "inactive" as const,
  updatedAtUtc: "2026-09-01 09:00:00.000000",
};
const project = {
  ...archiveMetadata,
  budgetAmount: null,
  closedAtUtc: "2026-09-03 09:00:00.000000",
  createdAtUtc: "2026-09-01 09:00:00.000000",
  currency: "TRY" as const,
  displayName: "Portal",
  id: projectId,
  internalNote: null,
  objective: null,
  projectType: "internal" as const,
  shortCode: "PORTAL",
  startsOn: null,
  status: "completed" as const,
  targetEndsOn: null,
  updatedAtUtc: "2026-09-03 09:00:00.000000",
};
const task = {
  ...archiveMetadata,
  assigneeUserAccountId: actorId,
  completedAtUtc: null,
  createdAtUtc: "2026-09-01 09:00:00.000000",
  customerId: null,
  description: null,
  dueOn: null,
  id: taskId,
  priority: "normal" as const,
  projectId: null,
  status: "cancelled" as const,
  title: "İptal edilen görev",
  updatedAtUtc: "2026-09-03 09:00:00.000000",
};
const contract = {
  ...archiveMetadata,
  createdAtUtc: "2026-09-01 09:00:00.000000",
  currency: "TRY" as const,
  customerId,
  endsOn: "2026-09-30",
  id: contractId,
  internalNote: null,
  monthlyFeeAmount: "1000.0000",
  paymentDay: 5,
  projectId,
  startsOn: "2026-09-01",
  status: "closed" as const,
  updatedAtUtc: "2026-09-03 09:00:00.000000",
  vatMode: "exempt" as const,
  vatRate: "0.00",
};

describe("record lifecycle services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerForUpdate.mockResolvedValue(customer);
    mocks.findProjectForUpdate.mockResolvedValue(project);
    mocks.findTaskStateForUpdate.mockResolvedValue(task);
    mocks.findOwnedContractForUpdate.mockResolvedValue(contract);
    mocks.customerHasLifecycleDependencies.mockResolvedValue(false);
    mocks.projectHasLifecycleDependencies.mockResolvedValue(false);
    mocks.contractHasLifecycleDependencies.mockResolvedValue(false);
    mocks.updateCustomerRecord.mockResolvedValue(true);
    mocks.updateProjectRecord.mockResolvedValue(true);
    mocks.updateTaskRecord.mockResolvedValue(true);
    mocks.updateContractRecord.mockResolvedValue(true);
  });

  it("archives an inactive customer with actor metadata and an optimistic fence", async () => {
    const result = await changeCustomerLifecycle(
      {} as Pool,
      customerId,
      { action: "archive", reason: "  Saklama süresi  ", version: 3 },
      context,
    );

    expect(result).toMatchObject({
      archiveReason: "Saklama süresi",
      archivedByUserAccountId: actorId,
      version: 4,
    });
    expect(mocks.updateCustomerRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
      3,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId, action: "customer.archived" }),
    );
  });

  it("rejects a stale customer command before dependency evaluation", async () => {
    await expect(
      changeCustomerLifecycle(
        {} as Pool,
        customerId,
        { action: "archive", reason: "Eski istek", version: 2 },
        context,
      ),
    ).rejects.toBeInstanceOf(domainErrors.CustomerVersionConflictError);
    expect(mocks.customerHasLifecycleDependencies).not.toHaveBeenCalled();
  });

  it("rejects project archival while active dependencies remain", async () => {
    mocks.projectHasLifecycleDependencies.mockResolvedValue(true);
    await expect(
      changeProjectLifecycle(
        {} as Pool,
        projectId,
        { action: "archive", reason: "Bitti", version: 3 },
        context,
      ),
    ).rejects.toBeInstanceOf(LifecycleDependencyConflictError);
    expect(mocks.updateProjectRecord).not.toHaveBeenCalled();
  });

  it("restores an archived terminal project without retaining archive metadata", async () => {
    mocks.findProjectForUpdate.mockResolvedValue({
      ...project,
      archiveReason: "Tamamlandı",
      archivedAtUtc: "2026-09-04 09:00:00.000000",
      archivedByUserAccountId: actorId,
    });

    const result = await changeProjectLifecycle(
      {} as Pool,
      projectId,
      { action: "restore", reason: "Yeniden görünür", version: 3 },
      context,
    );

    expect(result).toMatchObject({
      archiveReason: null,
      archivedAtUtc: null,
      archivedByUserAccountId: null,
      version: 4,
    });
    expect(mocks.updateProjectRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
      3,
    );
  });

  it("accepts cancelled as a terminal task archival state", async () => {
    await expect(
      changeTaskLifecycle(
        {} as Pool,
        taskId,
        { action: "archive", reason: "İptal", version: 3 },
        context,
      ),
    ).resolves.toMatchObject({ archivedByUserAccountId: actorId, version: 4 });
  });

  it("fails closed when restoring a contract under an archived parent", async () => {
    mocks.findCustomerForUpdate.mockResolvedValue({
      ...customer,
      archiveReason: "Kapandı",
      archivedAtUtc: "2026-09-04 09:00:00.000000",
      archivedByUserAccountId: actorId,
    });
    mocks.findOwnedContractForUpdate.mockResolvedValue({
      ...contract,
      archiveReason: "Kapandı",
      archivedAtUtc: "2026-09-04 09:00:00.000000",
      archivedByUserAccountId: actorId,
    });

    await expect(
      changeContractLifecycle(
        {} as Pool,
        customerId,
        contractId,
        { action: "restore", version: 3 },
        context,
      ),
    ).rejects.toBeInstanceOf(LifecycleParentUnavailableError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });

  it("checks closed-contract dependencies before archival", async () => {
    mocks.contractHasLifecycleDependencies.mockResolvedValue(true);

    await expect(
      changeContractLifecycle(
        {} as Pool,
        customerId,
        contractId,
        { action: "archive", reason: "Dönem kapandı", version: 3 },
        context,
      ),
    ).rejects.toBeInstanceOf(LifecycleDependencyConflictError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });
});
