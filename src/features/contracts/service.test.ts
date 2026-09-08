// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  contractHasReceivable: vi.fn(),
  contractHasVisitOutsideRange: vi.fn(),
  deleteEditableMonthVisits: vi.fn(),
  findActiveCustomerProjectForUpdate: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findOverlappingContract: vi.fn(),
  findOwnedContractForUpdate: vi.fn(),
  findOwnedVisitForUpdate: vi.fn(),
  findTaskStateForUpdate: vi.fn(),
  insertContractRecord: vi.fn(),
  insertVisitRecords: vi.fn(),
  insertTaskVisitRecord: vi.fn(),
  listVisitWorkItemReferences: vi.fn(),
  listMonthVisitRecords: vi.fn(),
  createTaskInTransaction: vi.fn(),
  updateContractRecord: vi.fn(),
  updateVisitRecord: vi.fn(),
}));

vi.mock("@/features/customers/repository", () => ({
  findActiveCustomerProjectForUpdate: mocks.findActiveCustomerProjectForUpdate,
  findCustomerForUpdate: mocks.findCustomerForUpdate,
}));

vi.mock("@/features/contracts/repository", () => ({
  contractHasVisitOutsideRange: mocks.contractHasVisitOutsideRange,
  contractHasReceivable: mocks.contractHasReceivable,
  deleteEditableMonthVisits: mocks.deleteEditableMonthVisits,
  findOverlappingContract: mocks.findOverlappingContract,
  findOwnedContractForUpdate: mocks.findOwnedContractForUpdate,
  findOwnedVisitForUpdate: mocks.findOwnedVisitForUpdate,
  insertContractRecord: mocks.insertContractRecord,
  insertVisitRecords: mocks.insertVisitRecords,
  listContractRecords: vi.fn(),
  listMonthVisitRecords: mocks.listMonthVisitRecords,
  updateContractRecord: mocks.updateContractRecord,
  updateVisitRecord: mocks.updateVisitRecord,
}));

vi.mock("@/features/tasks/service", () => ({
  createTaskInTransaction: mocks.createTaskInTransaction,
}));

vi.mock("@/features/tasks/repository", () => ({
  findTaskStateForUpdate: mocks.findTaskStateForUpdate,
}));

vi.mock("@/features/tasks/visit-repository", () => ({
  insertTaskVisitRecord: mocks.insertTaskVisitRecord,
  listVisitWorkItemReferences: mocks.listVisitWorkItemReferences,
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

import {
  ContractPeriodConflictError,
  ContractProjectLockedError,
  ContractProjectUnavailableError,
  ContractVisitRangeConflictError,
  createCustomerContract,
  replaceMonthlyVisitPlan,
  updateMonthlyVisitWithWorkItems,
  updateCustomerContract,
  VisitLockedError,
  VisitWorkItemIdentityConflictError,
} from "@/features/contracts/service";

const customerId = "10000000-0000-4000-8000-000000000001";
const contractId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const otherProjectId = "30000000-0000-4000-8000-000000000002";
const visitId = "40000000-0000-4000-8000-000000000001";
const before = {
  archiveReason: null,
  archivedAtUtc: null,
  archivedByUserAccountId: null,
  createdAtUtc: "2026-09-01 09:00:00.000000",
  currency: "TRY" as const,
  customerId,
  endsOn: "2027-08-31",
  id: contractId,
  internalNote: null,
  monthlyFeeAmount: "50000.0000",
  paymentDay: 5,
  projectId,
  startsOn: "2026-09-01",
  status: "active" as const,
  updatedAtUtc: "2026-09-01 09:00:00.000000",
  vatMode: "exclusive" as const,
  vatRate: "20.00",
  version: 1,
};
const input = {
  endsOn: "2026-12-31",
  internalNote: "2026 çalışma dönemi",
  monthlyFeeAmount: "60000",
  paymentDay: 15,
  projectId,
  startsOn: "2026-02-01",
  status: "active" as const,
  vatMode: "exempt" as const,
  vatRate: "0",
};
const updateInput = { ...input, version: 1 };
const context = {
  actorId: "80000000-0000-4000-8000-000000000001",
  correlationId: "contract-edit-test",
  now: new Date("2026-09-01T12:00:00.000Z"),
};
const plannedVisit = {
  committedOn: "2026-09-03",
  contractId,
  createdAtUtc: "2026-09-01 09:00:00.000000",
  deliveredOn: null,
  id: visitId,
  internalDurationMinutes: 120,
  internalPlannedAtUtc: "2026-09-03 06:00:00.000000",
  locationLabel: null,
  resolutionNote: null,
  resolutionStatus: "planned" as const,
  updatedAtUtc: "2026-09-01 09:00:00.000000",
};

describe("contract write service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerForUpdate.mockResolvedValue({
      id: customerId,
      status: "active",
    });
    mocks.findOwnedContractForUpdate.mockResolvedValue(before);
    mocks.findOwnedVisitForUpdate.mockResolvedValue(plannedVisit);
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue({
      customerId,
      projectId,
    });
    mocks.findOverlappingContract.mockResolvedValue(null);
    mocks.findTaskStateForUpdate.mockResolvedValue(null);
    mocks.listMonthVisitRecords.mockResolvedValue([]);
    mocks.listVisitWorkItemReferences.mockResolvedValue([]);
    mocks.contractHasReceivable.mockResolvedValue(false);
    mocks.contractHasVisitOutsideRange.mockResolvedValue(false);
    mocks.updateContractRecord.mockResolvedValue(true);
    mocks.updateVisitRecord.mockResolvedValue(undefined);
  });

  it("stores a normalized optional location with a monthly visit plan", async () => {
    const result = await replaceMonthlyVisitPlan(
      {} as Pool,
      customerId,
      contractId,
      "2026-09",
      {
        visits: [
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: 120,
            internalStartTime: "09:00",
            locationLabel: "  Fabrika A  ",
          },
        ],
      },
      context,
    );

    expect(mocks.insertVisitRecords).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          committedOn: "2026-09-03",
          internalDurationMinutes: 120,
          internalPlannedAtUtc: "2026-09-03 06:00:00.000000",
          locationLabel: "Fabrika A",
        }),
      ],
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        afterSummary: expect.objectContaining({ locations: ["Fabrika A"] }),
      }),
    );
    expect(result.visits[0]?.locationLabel).toBe("Fabrika A");
  });

  it("edits a makeup visit while preserving finalized visits", async () => {
    const makeupVisit = {
      ...plannedVisit,
      locationLabel: "Eski konum",
      resolutionNote: "Telafi planlanacak",
      resolutionStatus: "makeup_pending" as const,
    };
    const completedVisit = {
      ...plannedVisit,
      committedOn: "2026-09-10",
      deliveredOn: "2026-09-10",
      id: "40000000-0000-4000-8000-000000000002",
      internalDurationMinutes: null,
      internalPlannedAtUtc: null,
      resolutionStatus: "completed" as const,
    };
    mocks.listMonthVisitRecords.mockResolvedValueOnce([
      makeupVisit,
      completedVisit,
    ]);

    const result = await replaceMonthlyVisitPlan(
      {} as Pool,
      customerId,
      contractId,
      "2026-09",
      {
        visits: [
          {
            committedOn: "2026-09-04",
            id: visitId,
            internalDurationMinutes: 120,
            internalStartTime: "10:00",
            locationLabel: "Yeni konum",
          },
          {
            committedOn: completedVisit.committedOn,
            id: completedVisit.id,
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: completedVisit.locationLabel,
          },
        ],
      },
      context,
    );

    expect(mocks.deleteEditableMonthVisits).toHaveBeenCalledWith(
      expect.anything(),
      contractId,
      "2026-09-01",
      "2026-10-01",
    );
    expect(mocks.insertVisitRecords).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        committedOn: "2026-09-04",
        id: visitId,
        internalPlannedAtUtc: "2026-09-04 07:00:00.000000",
        locationLabel: "Yeni konum",
        resolutionStatus: "makeup_pending",
      }),
    ]);
    expect(result.visits).toEqual([
      expect.objectContaining({ id: visitId, resolutionStatus: "makeup_pending" }),
      completedVisit,
    ]);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        afterSummary: expect.objectContaining({
          resolutionStatuses: ["makeup_pending", "completed"],
          visitIds: [visitId, completedVisit.id],
        }),
      }),
    );
  });

  it("can remove and recreate an editable visit on the same day", async () => {
    mocks.listMonthVisitRecords.mockResolvedValueOnce([plannedVisit]);

    const result = await replaceMonthlyVisitPlan(
      {} as Pool,
      customerId,
      contractId,
      "2026-09",
      {
        visits: [
          {
            committedOn: plannedVisit.committedOn,
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: "Yeni ziyaret",
          },
        ],
      },
      context,
    );

    const inserted = mocks.insertVisitRecords.mock.calls[0]?.[1]?.[0];
    expect(mocks.deleteEditableMonthVisits).toHaveBeenCalledOnce();
    expect(inserted).toMatchObject({
      committedOn: plannedVisit.committedOn,
      locationLabel: "Yeni ziyaret",
      resolutionStatus: "planned",
    });
    expect(inserted?.id).not.toBe(visitId);
    expect(result.visits[0]?.id).toBe(inserted?.id);
  });

  it("completes a visit and links each work item as a done customer-project task", async () => {
    const tasks = [
      {
        id: "50000000-0000-4000-8000-000000000001",
        status: "done",
        title: "Süreç akışı çıkarıldı",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        status: "done",
        title: "Riskler paylaşıldı",
      },
    ];
    mocks.createTaskInTransaction
      .mockResolvedValueOnce(tasks[0])
      .mockResolvedValueOnce(tasks[1]);

    const result = await updateMonthlyVisitWithWorkItems(
      {} as Pool,
      customerId,
      contractId,
      visitId,
      {
        deliveredOn: "2026-09-03",
        resolutionNote: "Saha çalışması tamamlandı",
        resolutionStatus: "completed",
        workItems: ["Süreç akışı çıkarıldı", "Riskler paylaşıldı"],
      },
      context,
    );

    expect(result).toEqual({
      tasks,
      visit: expect.objectContaining({
        deliveredOn: "2026-09-03",
        resolutionStatus: "completed",
      }),
    });
    expect(mocks.updateVisitRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deliveredOn: "2026-09-03",
        id: visitId,
        resolutionStatus: "completed",
      }),
    );
    expect(mocks.createTaskInTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.createTaskInTransaction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        customerId,
        description: null,
        dueOn: "2026-09-03",
        priority: "normal",
        projectId,
        status: "done",
        title: "Süreç akışı çıkarıldı",
      },
      expect.objectContaining({
        actorId: context.actorId,
        correlationId: context.correlationId,
        now: context.now,
      }),
    );
    expect(mocks.insertTaskVisitRecord.mock.calls).toEqual([
      [
        expect.anything(),
        tasks[0].id,
        visitId,
        "2026-09-01 12:00:00.000000",
      ],
      [
        expect.anything(),
        tasks[1].id,
        visitId,
        "2026-09-01 12:00:00.000000",
      ],
    ]);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "work_task.visit_linked",
        afterSummary: { contractId, customerId, visitId },
        entityId: tasks[0].id,
      }),
    );
    const sharedConnection = mocks.updateVisitRecord.mock.calls[0]?.[0];
    expect(mocks.createTaskInTransaction.mock.calls[0]?.[0]).toBe(
      sharedConnection,
    );
    expect(mocks.insertTaskVisitRecord.mock.calls[0]?.[0]).toBe(
      sharedConnection,
    );
  });

  it("edits only the note of a completed visit without creating work items", async () => {
    const completedVisit = {
      ...plannedVisit,
      deliveredOn: "2026-09-03",
      resolutionNote: "İlk ziyaret notu",
      resolutionStatus: "completed" as const,
    };
    mocks.findOwnedVisitForUpdate.mockResolvedValue(completedVisit);

    const result = await updateMonthlyVisitWithWorkItems(
      {} as Pool,
      customerId,
      contractId,
      visitId,
      {
        deliveredOn: completedVisit.deliveredOn,
        resolutionNote: "Güncellenen ziyaret notu",
        resolutionStatus: "completed",
        workItems: [],
      },
      context,
    );

    expect(result.visit).toMatchObject({
      deliveredOn: completedVisit.deliveredOn,
      resolutionNote: "Güncellenen ziyaret notu",
      resolutionStatus: "completed",
    });
    expect(mocks.updateVisitRecord).toHaveBeenCalledOnce();
    expect(mocks.createTaskInTransaction).not.toHaveBeenCalled();
    expect(mocks.listVisitWorkItemReferences).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "monthly_visit_commitment.updated",
        entityId: visitId,
      }),
    );
  });

  it("appends only new identified work items and treats their retry as a no-op", async () => {
    const completedVisit = {
      ...plannedVisit,
      deliveredOn: "2026-09-03",
      resolutionStatus: "completed" as const,
    };
    const existingTaskId = "50000000-0000-4000-8000-000000000001";
    const newTaskId = "50000000-0000-4000-8000-000000000002";
    const newTask = {
      id: newTaskId,
      status: "done",
      title: "Sonradan eklenen uygulama",
    };
    const workItems = [
      { id: existingTaskId, title: "Mevcut uygulama" },
      { id: newTaskId, title: newTask.title },
    ];
    mocks.findOwnedVisitForUpdate.mockResolvedValue(completedVisit);
    mocks.listVisitWorkItemReferences
      .mockResolvedValueOnce([
        { taskId: existingTaskId, title: "Mevcut uygulama" },
      ])
      .mockResolvedValueOnce([
        { taskId: existingTaskId, title: "Mevcut uygulama" },
        { taskId: newTaskId, title: newTask.title },
      ]);
    mocks.createTaskInTransaction.mockResolvedValue(newTask);

    const first = await updateMonthlyVisitWithWorkItems(
      {} as Pool,
      customerId,
      contractId,
      visitId,
      {
        deliveredOn: completedVisit.deliveredOn,
        resolutionNote: "Uygulama eklendi",
        resolutionStatus: "completed",
        workItems,
      },
      context,
    );
    const retry = await updateMonthlyVisitWithWorkItems(
      {} as Pool,
      customerId,
      contractId,
      visitId,
      {
        deliveredOn: completedVisit.deliveredOn,
        resolutionNote: "Uygulama eklendi",
        resolutionStatus: "completed",
        workItems,
      },
      context,
    );

    expect(first.tasks).toEqual([newTask]);
    expect(retry.tasks).toEqual([]);
    expect(mocks.createTaskInTransaction).toHaveBeenCalledOnce();
    expect(mocks.createTaskInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: newTask.title }),
      expect.objectContaining({ now: context.now }),
      newTaskId,
    );
    expect(mocks.insertTaskVisitRecord).toHaveBeenCalledOnce();
    expect(mocks.insertTaskVisitRecord).toHaveBeenCalledWith(
      expect.anything(),
      newTaskId,
      visitId,
      "2026-09-01 12:00:00.000000",
    );
    expect(mocks.findTaskStateForUpdate).toHaveBeenCalledOnce();
  });

  it("keeps a completed visit date and status locked while appending", async () => {
    const completedVisit = {
      ...plannedVisit,
      deliveredOn: "2026-09-03",
      resolutionStatus: "completed" as const,
    };
    mocks.findOwnedVisitForUpdate.mockResolvedValue(completedVisit);

    await expect(
      updateMonthlyVisitWithWorkItems(
        {} as Pool,
        customerId,
        contractId,
        visitId,
        {
          deliveredOn: "2026-09-04",
          resolutionNote: completedVisit.resolutionNote,
          resolutionStatus: "completed",
          workItems: [
            {
              id: "50000000-0000-4000-8000-000000000001",
              title: "Sonradan eklenen uygulama",
            },
          ],
        },
        context,
      ),
    ).rejects.toBeInstanceOf(VisitLockedError);
    await expect(
      updateMonthlyVisitWithWorkItems(
        {} as Pool,
        customerId,
        contractId,
        visitId,
        {
          deliveredOn: null,
          resolutionNote: "Telafiye alınmamalı",
          resolutionStatus: "makeup_pending",
          workItems: [],
        },
        context,
      ),
    ).rejects.toBeInstanceOf(VisitLockedError);
    expect(mocks.updateVisitRecord).not.toHaveBeenCalled();
    expect(mocks.createTaskInTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when a new work item identity belongs to another task", async () => {
    const completedVisit = {
      ...plannedVisit,
      deliveredOn: "2026-09-03",
      resolutionStatus: "completed" as const,
    };
    const conflictingTaskId = "50000000-0000-4000-8000-000000000001";
    mocks.findOwnedVisitForUpdate.mockResolvedValue(completedVisit);
    mocks.findTaskStateForUpdate.mockResolvedValue({ id: conflictingTaskId });

    await expect(
      updateMonthlyVisitWithWorkItems(
        {} as Pool,
        customerId,
        contractId,
        visitId,
        {
          deliveredOn: completedVisit.deliveredOn,
          resolutionNote: null,
          resolutionStatus: "completed",
          workItems: [
            { id: conflictingTaskId, title: "Çakışan uygulama" },
          ],
        },
        context,
      ),
    ).rejects.toBeInstanceOf(VisitWorkItemIdentityConflictError);
    expect(mocks.createTaskInTransaction).not.toHaveBeenCalled();
    expect(mocks.insertTaskVisitRecord).not.toHaveBeenCalled();
  });

  it("rejects completed work items without a delivery date before a transaction", async () => {
    await expect(
      updateMonthlyVisitWithWorkItems(
        {} as Pool,
        customerId,
        contractId,
        visitId,
        {
          deliveredOn: null,
          resolutionNote: null,
          resolutionStatus: "completed",
          workItems: ["Tamamlanan çalışma"],
        },
        context,
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(mocks.updateVisitRecord).not.toHaveBeenCalled();
    expect(mocks.createTaskInTransaction).not.toHaveBeenCalled();
  });

  it("updates the owned contract transactionally and appends before/after audit", async () => {
    const result = await updateCustomerContract(
      {} as Pool,
      customerId,
      contractId,
      updateInput,
      context,
    );

    expect(result).toMatchObject({
      endsOn: "2026-12-31",
      monthlyFeeAmount: "60000.0000",
      paymentDay: 15,
      startsOn: "2026-02-01",
      vatMode: "exempt",
      vatRate: "0.00",
    });
    expect(mocks.findOverlappingContract).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      projectId,
      "2026-02-01",
      "2026-12-31",
      contractId,
    );
    expect(mocks.updateContractRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
      1,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "consulting_contract.updated",
        actorId: context.actorId,
        beforeSummary: expect.objectContaining({ startsOn: "2026-09-01" }),
        afterSummary: expect.objectContaining({ startsOn: "2026-02-01" }),
      }),
    );
  });

  it("creates a project-scoped contract for an active customer-project link", async () => {
    const result = await createCustomerContract(
      {} as Pool,
      customerId,
      input,
      context,
    );

    expect(result.projectId).toBe(projectId);
    expect(mocks.findActiveCustomerProjectForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      projectId,
    );
    expect(mocks.findOverlappingContract).toHaveBeenCalledWith(
      expect.anything(),
      customerId,
      projectId,
      input.startsOn,
      input.endsOn,
    );
    expect(mocks.insertContractRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "consulting_contract.created",
        actorId: context.actorId,
        afterSummary: expect.objectContaining({ projectId }),
      }),
    );
  });

  it("rejects contract creation outside the customer's active project portfolio", async () => {
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      createCustomerContract(
        {} as Pool,
        customerId,
        { ...input, projectId: otherProjectId },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectUnavailableError);
    expect(mocks.findOverlappingContract).not.toHaveBeenCalled();
    expect(mocks.insertContractRecord).not.toHaveBeenCalled();
  });

  it("rejects overlap before updating or auditing", async () => {
    mocks.findOverlappingContract.mockResolvedValue({
      ...before,
      id: "20000000-0000-4000-8000-000000000002",
    });

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        updateInput,
        context,
      ),
    ).rejects.toBeInstanceOf(ContractPeriodConflictError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("maps the database unique constraint to the same friendly conflict", async () => {
    mocks.updateContractRecord.mockRejectedValue({ code: "ER_DUP_ENTRY" });

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        updateInput,
        context,
      ),
    ).rejects.toBeInstanceOf(ContractPeriodConflictError);
  });

  it("does not allow an edit to strand an existing visit outside the period", async () => {
    mocks.contractHasVisitOutsideRange.mockResolvedValue(true);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        updateInput,
        context,
      ),
    ).rejects.toBeInstanceOf(ContractVisitRangeConflictError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });

  it("rejects a project outside the customer's active project portfolio", async () => {
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        { ...updateInput, projectId: otherProjectId },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectUnavailableError);
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });

  it("allows corrections to a closed historical contract when its project link is inactive", async () => {
    mocks.findOwnedContractForUpdate.mockResolvedValue({
      ...before,
      status: "closed",
    });
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    const result = await updateCustomerContract(
      {} as Pool,
      customerId,
      contractId,
      { ...updateInput, projectId, status: "closed" },
      context,
    );

    expect(result).toMatchObject({
      internalNote: "2026 çalışma dönemi",
      projectId,
      status: "closed",
    });
    expect(mocks.findActiveCustomerProjectForUpdate).not.toHaveBeenCalled();
    expect(mocks.contractHasReceivable).not.toHaveBeenCalled();
    expect(mocks.updateContractRecord).toHaveBeenCalledWith(
      expect.anything(),
      result,
      1,
    );
  });

  it("requires an active project link before reopening a historical contract", async () => {
    mocks.findOwnedContractForUpdate.mockResolvedValue({
      ...before,
      status: "closed",
    });
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue(null);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        { ...updateInput, projectId, status: "active" },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectUnavailableError);
    expect(mocks.contractHasReceivable).not.toHaveBeenCalled();
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });

  it("locks project attribution after the contract has produced a receivable", async () => {
    mocks.findActiveCustomerProjectForUpdate.mockResolvedValue({
      customerId,
      projectId: otherProjectId,
    });
    mocks.contractHasReceivable.mockResolvedValue(true);

    await expect(
      updateCustomerContract(
        {} as Pool,
        customerId,
        contractId,
        { ...updateInput, projectId: otherProjectId },
        context,
      ),
    ).rejects.toBeInstanceOf(ContractProjectLockedError);
    expect(mocks.findOverlappingContract).not.toHaveBeenCalled();
    expect(mocks.updateContractRecord).not.toHaveBeenCalled();
  });
});
