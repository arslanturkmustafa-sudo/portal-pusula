import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool, PoolConnection } from "mysql2/promise";

import {
  findActiveCustomerProjectForUpdate,
  findCustomerForUpdate,
} from "@/features/customers/repository";
import { summarizeVisitMonth } from "@/features/contracts/month-summary";
import {
  contractHasVisitOutsideRange,
  contractHasReceivable,
  deleteEditableMonthVisits,
  findOverlappingContract,
  findOwnedContractForUpdate,
  findOwnedVisitForUpdate,
  insertContractRecord,
  insertVisitRecords,
  type ConsultingContract,
  listContractRecords,
  listMonthVisitRecords,
  type MonthlyVisit,
  updateContractRecord,
  updateVisitRecord,
} from "@/features/contracts/repository";
import {
  type CreateContractInput,
  createContractInputSchema,
  type MonthlyVisitPlanInput,
  monthParameterSchema,
  monthlyVisitPlanInputSchema,
  type UpdateContractInput,
  updateContractInputSchema,
  type UpdateVisitResolutionInput,
  updateVisitResolutionInputSchema,
  type UpdateVisitWithWorkItemsInput,
  updateVisitWithWorkItemsInputSchema,
} from "@/features/contracts/validation";
import { LifecycleArchivedRecordError } from "@/features/lifecycle";
import {
  findTaskStateForUpdate,
  type WorkTask,
} from "@/features/tasks/repository";
import { createTaskInTransaction } from "@/features/tasks/service";
import {
  insertTaskVisitRecord,
  listVisitWorkItemReferences,
} from "@/features/tasks/visit-repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class ContractResourceNotFoundError extends Error {
  constructor() {
    super("The requested contract resource was not found.");
    this.name = "ContractResourceNotFoundError";
  }
}

export class ContractCustomerInactiveError extends Error {
  constructor() {
    super("The customer is inactive.");
    this.name = "ContractCustomerInactiveError";
  }
}

export class ContractPeriodConflictError extends Error {
  constructor() {
    super("The contract period overlaps an existing contract.");
    this.name = "ContractPeriodConflictError";
  }
}

export class ContractProjectUnavailableError extends Error {
  constructor() {
    super("The project is not an active project for this customer.");
    this.name = "ContractProjectUnavailableError";
  }
}

export class ContractProjectLockedError extends Error {
  constructor() {
    super("The contract project cannot change after a receivable is created.");
    this.name = "ContractProjectLockedError";
  }
}

export class ContractVisitRangeConflictError extends Error {
  constructor() {
    super("The edited contract period excludes an existing visit.");
    this.name = "ContractVisitRangeConflictError";
  }
}

export class ContractClosedError extends Error {
  constructor() {
    super("The contract is not active.");
    this.name = "ContractClosedError";
  }
}

export class ContractVersionConflictError extends Error {
  constructor() {
    super("The contract was changed by another request.");
    this.name = "ContractVersionConflictError";
  }
}

export class MonthOutsideContractError extends Error {
  constructor() {
    super("The requested month is outside the contract period.");
    this.name = "MonthOutsideContractError";
  }
}

export class MonthPlanLockedError extends Error {
  constructor() {
    super("The month plan contains resolved visits.");
    this.name = "MonthPlanLockedError";
  }
}

export class VisitLockedError extends Error {
  constructor() {
    super("The visit is already resolved.");
    this.name = "VisitLockedError";
  }
}

export class VisitWorkItemIdentityConflictError extends Error {
  constructor() {
    super("The visit work item identity is already in use.");
    this.name = "VisitWorkItemIdentityConflictError";
  }
}

export class VisitDayConflictError extends Error {
  constructor() {
    super("A visit already exists on the requested day.");
    this.name = "VisitDayConflictError";
  }
}

export type ContractWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

export type MonthlyVisitPlan = Readonly<{
  contractId: string;
  month: string;
  summary: ReturnType<typeof summarizeVisitMonth>;
  visits: readonly MonthlyVisit[];
}>;

export type MonthlyVisitWorkItemUpdate = Readonly<{
  tasks: readonly WorkTask[];
  visit: MonthlyVisit;
}>;

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function monthBounds(month: string): Readonly<{
  monthStart: string;
  nextMonthStart: string;
}> {
  const canonicalMonth = monthParameterSchema.parse(month);
  const year = Number(canonicalMonth.slice(0, 4));
  const monthIndex = Number(canonicalMonth.slice(5, 7)) - 1;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    monthStart: monthStart.toISOString().slice(0, 10),
    nextMonthStart: nextMonth.toISOString().slice(0, 10),
  };
}

function monthIntersectsContract(
  contract: ConsultingContract,
  monthStart: string,
  nextMonthStart: string,
): boolean {
  return monthStart <= contract.endsOn && nextMonthStart > contract.startsOn;
}

function localPlanDateTimeToUtc(
  committedOn: string,
  internalStartTime: string | null,
): string | null {
  if (internalStartTime === null) return null;
  return toUtcDateTime6(
    new Date(`${committedOn}T${internalStartTime}:00+03:00`),
  );
}

function contractAuditSummary(contract: ConsultingContract) {
  return {
    archivedAtUtc: contract.archivedAtUtc,
    customerId: contract.customerId,
    endsOn: contract.endsOn,
    monthlyFeeAmount: contract.monthlyFeeAmount,
    paymentDay: contract.paymentDay,
    projectId: contract.projectId,
    startsOn: contract.startsOn,
    status: contract.status,
    vatMode: contract.vatMode,
    vatRate: contract.vatRate,
    version: contract.version,
  };
}

function planAuditSummary(month: string, visits: readonly MonthlyVisit[]) {
  return {
    committedOn: visits.map((visit) => visit.committedOn),
    locations: visits.map((visit) => visit.locationLabel),
    month,
    resolutionStatuses: visits.map((visit) => visit.resolutionStatus),
    visitCount: visits.length,
    visitIds: visits.map((visit) => visit.id),
  };
}

function visitAuditSummary(visit: MonthlyVisit) {
  return {
    committedOn: visit.committedOn,
    deliveredOn: visit.deliveredOn,
    resolutionStatus: visit.resolutionStatus,
  };
}

function sameVisitPlan(
  existing: readonly MonthlyVisit[],
  requested: readonly MonthlyVisit[],
): boolean {
  if (existing.length !== requested.length) return false;
  return existing.every((visit, index) => {
    const other = requested[index];
    return (
      other !== undefined &&
      visit.id === other.id &&
      visit.committedOn === other.committedOn &&
      visit.internalPlannedAtUtc === other.internalPlannedAtUtc &&
      visit.internalDurationMinutes === other.internalDurationMinutes &&
      visit.locationLabel === other.locationLabel &&
      visit.deliveredOn === other.deliveredOn &&
      visit.resolutionNote === other.resolutionNote &&
      visit.resolutionStatus === other.resolutionStatus
    );
  });
}

function isEditableVisit(visit: MonthlyVisit): boolean {
  return (
    visit.resolutionStatus === "planned" ||
    visit.resolutionStatus === "makeup_pending"
  );
}

function monthlyPlan(
  contractId: string,
  month: string,
  visits: readonly MonthlyVisit[],
): MonthlyVisitPlan {
  return {
    contractId,
    month,
    summary: summarizeVisitMonth(visits),
    visits,
  };
}

export async function listCustomerContracts(
  pool: Pool,
  customerId: string,
): Promise<readonly ConsultingContract[]> {
  assertCanonicalUuid(customerId);
  return withUtcTransaction(pool, async (connection) => {
    const customer = await findCustomerForUpdate(connection, customerId);
    if (!customer) throw new ContractResourceNotFoundError();
    return listContractRecords(connection, customerId);
  });
}

export async function createCustomerContract(
  pool: Pool,
  customerId: string,
  rawInput: CreateContractInput,
  context: ContractWriteContext,
): Promise<ConsultingContract> {
  assertCanonicalUuid(customerId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = createContractInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  try {
    return await withUtcTransaction(pool, async (connection) => {
      const customer = await findCustomerForUpdate(connection, customerId);
      if (!customer) throw new ContractResourceNotFoundError();
      if (customer.status !== "active") throw new ContractCustomerInactiveError();
      if (
        !(await findActiveCustomerProjectForUpdate(
          connection,
          customerId,
          input.projectId,
        ))
      ) {
        throw new ContractProjectUnavailableError();
      }

      if (
        input.status !== "closed" &&
        (await findOverlappingContract(
          connection,
          customerId,
          input.projectId,
          input.startsOn,
          input.endsOn,
        ))
      ) {
        throw new ContractPeriodConflictError();
      }

      const contract: ConsultingContract = {
        archiveReason: null,
        archivedAtUtc: null,
        archivedByUserAccountId: null,
        createdAtUtc: now,
        currency: "TRY",
        customerId,
        endsOn: input.endsOn,
        id: randomUUID(),
        internalNote: input.internalNote,
        monthlyFeeAmount: input.monthlyFeeAmount,
        paymentDay: input.paymentDay,
        projectId: input.projectId,
        startsOn: input.startsOn,
        status: input.status,
        updatedAtUtc: now,
        vatMode: input.vatMode,
        vatRate: input.vatRate,
        version: 1,
      };

      await insertContractRecord(connection, contract);
      await appendAuditEvent(connection, {
        action: "consulting_contract.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: contractAuditSummary(contract),
        correlationId: context.correlationId,
        entityId: contract.id,
        entityType: "consulting_contract",
        occurredAtUtc: now,
      });
      return contract;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new ContractPeriodConflictError();
    throw error;
  }
}

export async function updateCustomerContract(
  pool: Pool,
  customerId: string,
  contractId: string,
  rawInput: UpdateContractInput,
  context: ContractWriteContext,
): Promise<ConsultingContract> {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(contractId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = updateContractInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  try {
    return await withUtcTransaction(pool, async (connection) => {
      // Every contract writer takes the customer lock first. Besides validating
      // ownership, this serializes overlap checks for the same customer.
      const customer = await findCustomerForUpdate(connection, customerId);
      if (!customer) throw new ContractResourceNotFoundError();

      const before = await findOwnedContractForUpdate(
        connection,
        customerId,
        contractId,
      );
      if (!before) throw new ContractResourceNotFoundError();
      if (before.archivedAtUtc !== null) {
        throw new LifecycleArchivedRecordError();
      }
      if (before.version !== input.version) {
        throw new ContractVersionConflictError();
      }
      const { version: expectedVersion, ...changes } = input;
      const projectChanged = changes.projectId !== before.projectId;
      const reopensHistoricalContract =
        before.status === "closed" && changes.status !== "closed";
      if (projectChanged || reopensHistoricalContract) {
        if (
          !(await findActiveCustomerProjectForUpdate(
            connection,
            customerId,
            changes.projectId,
          ))
        ) {
          throw new ContractProjectUnavailableError();
        }
        if (
          projectChanged &&
          (await contractHasReceivable(connection, contractId))
        ) {
          throw new ContractProjectLockedError();
        }
      }

      if (
        changes.status !== "closed" &&
        (await findOverlappingContract(
          connection,
          customerId,
          changes.projectId,
          changes.startsOn,
          changes.endsOn,
          contractId,
        ))
      ) {
        throw new ContractPeriodConflictError();
      }
      if (
        await contractHasVisitOutsideRange(
          connection,
          contractId,
          changes.startsOn,
          changes.endsOn,
        )
      ) {
        throw new ContractVisitRangeConflictError();
      }

      const after: ConsultingContract = {
        ...before,
        ...changes,
        updatedAtUtc: now,
        version: before.version + 1,
      };
      if (!(await updateContractRecord(connection, after, expectedVersion))) {
        throw new ContractVersionConflictError();
      }
      await appendAuditEvent(connection, {
        action: "consulting_contract.updated",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: contractAuditSummary(after),
        beforeSummary: contractAuditSummary(before),
        correlationId: context.correlationId,
        entityId: contractId,
        entityType: "consulting_contract",
        occurredAtUtc: now,
      });
      return after;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new ContractPeriodConflictError();
    throw error;
  }
}

export async function getMonthlyVisitPlan(
  pool: Pool,
  customerId: string,
  contractId: string,
  month: string,
): Promise<MonthlyVisitPlan> {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(contractId);
  const { monthStart, nextMonthStart } = monthBounds(month);

  return withUtcTransaction(pool, async (connection) => {
    const contract = await findOwnedContractForUpdate(
      connection,
      customerId,
      contractId,
    );
    if (!contract) throw new ContractResourceNotFoundError();
    if (!monthIntersectsContract(contract, monthStart, nextMonthStart)) {
      throw new MonthOutsideContractError();
    }
    const visits = await listMonthVisitRecords(
      connection,
      contractId,
      monthStart,
      nextMonthStart,
    );
    return monthlyPlan(contractId, month, visits);
  });
}

export async function replaceMonthlyVisitPlan(
  pool: Pool,
  customerId: string,
  contractId: string,
  month: string,
  rawInput: MonthlyVisitPlanInput,
  context: ContractWriteContext,
): Promise<MonthlyVisitPlan> {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(contractId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = monthlyVisitPlanInputSchema.parse(rawInput);
  const { monthStart, nextMonthStart } = monthBounds(month);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const contract = await findOwnedContractForUpdate(
      connection,
      customerId,
      contractId,
    );
    if (!contract) throw new ContractResourceNotFoundError();
    if (contract.status !== "active") throw new ContractClosedError();
    if (!monthIntersectsContract(contract, monthStart, nextMonthStart)) {
      throw new MonthOutsideContractError();
    }

    for (const visit of input.visits) {
      if (
        !visit.committedOn.startsWith(`${month}-`) ||
        visit.committedOn < contract.startsOn ||
        visit.committedOn > contract.endsOn
      ) {
        throw new MonthOutsideContractError();
      }
    }

    const existing = await listMonthVisitRecords(
      connection,
      contractId,
      monthStart,
      nextMonthStart,
      true,
    );
    const existingById = new Map(existing.map((visit) => [visit.id, visit]));
    const requestedIds = new Set(
      input.visits.flatMap((visit) =>
        visit.id === undefined ? [] : [visit.id],
      ),
    );
    const requested: MonthlyVisit[] = input.visits
      .map((visit) => ({
        committedOn: visit.committedOn,
        contractId,
        createdAtUtc:
          visit.id === undefined
            ? now
            : (existingById.get(visit.id)?.createdAtUtc ?? now),
        deliveredOn:
          visit.id === undefined
            ? null
            : (existingById.get(visit.id)?.deliveredOn ?? null),
        id: visit.id ?? randomUUID(),
        internalDurationMinutes: visit.internalDurationMinutes,
        internalPlannedAtUtc: localPlanDateTimeToUtc(
          visit.committedOn,
          visit.internalStartTime,
        ),
        locationLabel: visit.locationLabel,
        resolutionNote:
          visit.id === undefined
            ? null
            : (existingById.get(visit.id)?.resolutionNote ?? null),
        resolutionStatus:
          visit.id === undefined
            ? ("planned" as const)
            : (existingById.get(visit.id)?.resolutionStatus ?? "planned"),
        updatedAtUtc: now,
      }))
      .sort((left, right) => left.committedOn.localeCompare(right.committedOn));

    for (const visit of requested) {
      const before = existingById.get(visit.id);
      if (requestedIds.has(visit.id) && before === undefined) {
        throw new ContractResourceNotFoundError();
      }
      if (!before || isEditableVisit(before)) continue;
      if (!sameVisitPlan([before], [visit])) throw new VisitLockedError();
    }

    const persistedRequested = requested.map((visit) => {
      const before = existingById.get(visit.id);
      return before && !isEditableVisit(before) ? before : visit;
    });

    const preserved = existing.filter(
      (visit) =>
        (!isEditableVisit(visit) ||
          visit.resolutionStatus === "makeup_pending") &&
        !requestedIds.has(visit.id),
    );
    const after = [...preserved, ...persistedRequested].sort((left, right) =>
      left.committedOn === right.committedOn
        ? left.id.localeCompare(right.id)
        : left.committedOn.localeCompare(right.committedOn),
    );
    if (new Set(after.map((visit) => visit.committedOn)).size !== after.length) {
      throw new VisitDayConflictError();
    }

    if (sameVisitPlan(existing, after)) {
      return monthlyPlan(contractId, month, existing);
    }

    await deleteEditableMonthVisits(
      connection,
      contractId,
      monthStart,
      nextMonthStart,
    );
    await insertVisitRecords(connection, after.filter(isEditableVisit));
    await appendAuditEvent(connection, {
      action: "monthly_visit_plan.replaced",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: planAuditSummary(month, after),
      beforeSummary: planAuditSummary(month, existing),
      correlationId: context.correlationId,
      entityId: contractId,
      entityType: "consulting_contract",
      occurredAtUtc: now,
    });
    return monthlyPlan(contractId, month, after);
  });
}

async function updateMonthlyVisitInTransaction(
  connection: PoolConnection,
  customerId: string,
  contractId: string,
  visitId: string,
  input: UpdateVisitResolutionInput,
  context: ContractWriteContext,
  now: string,
  allowCompletedNoteEdit: boolean,
): Promise<
  Readonly<{
    contract: ConsultingContract;
    visit: MonthlyVisit;
  }>
> {
  const contract = await findOwnedContractForUpdate(
    connection,
    customerId,
    contractId,
  );
  if (!contract) throw new ContractResourceNotFoundError();
  if (contract.status !== "active") throw new ContractClosedError();

  const before = await findOwnedVisitForUpdate(connection, contractId, visitId);
  if (!before) throw new ContractResourceNotFoundError();
  if (before.resolutionStatus === "cancelled_by_agreement") {
    throw new VisitLockedError();
  }
  if (
    before.resolutionStatus === "completed" &&
    (!allowCompletedNoteEdit ||
      input.resolutionStatus !== "completed" ||
      input.deliveredOn !== before.deliveredOn)
  ) {
    throw new VisitLockedError();
  }
  if (
    before.resolutionStatus === "makeup_pending" &&
    input.resolutionStatus === "planned"
  ) {
    throw new VisitLockedError();
  }
  if (
    input.deliveredOn !== null &&
    input.deliveredOn.slice(0, 7) !== before.committedOn.slice(0, 7)
  ) {
    throw new MonthOutsideContractError();
  }

  const after: MonthlyVisit = {
    ...before,
    deliveredOn: input.deliveredOn,
    resolutionNote: input.resolutionNote,
    resolutionStatus: input.resolutionStatus,
    updatedAtUtc: now,
  };
  await updateVisitRecord(connection, after);
  await appendAuditEvent(connection, {
    action: "monthly_visit_commitment.updated",
    actorId: context.actorId,
    actorType: "user",
    afterSummary: visitAuditSummary(after),
    beforeSummary: visitAuditSummary(before),
    correlationId: context.correlationId,
    entityId: visitId,
    entityType: "monthly_visit_commitment",
    occurredAtUtc: now,
  });
  return { contract, visit: after };
}

function assertVisitWriteIdentifiers(
  customerId: string,
  contractId: string,
  visitId: string,
  actorId?: string,
): void {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(contractId);
  assertCanonicalUuid(visitId);
  if (actorId !== undefined) assertCanonicalUuid(actorId);
}

export async function updateMonthlyVisit(
  pool: Pool,
  customerId: string,
  contractId: string,
  visitId: string,
  rawInput: UpdateVisitResolutionInput,
  context: ContractWriteContext,
): Promise<MonthlyVisit> {
  assertVisitWriteIdentifiers(customerId, contractId, visitId, context.actorId);
  const input = updateVisitResolutionInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) =>
    (
      await updateMonthlyVisitInTransaction(
        connection,
        customerId,
        contractId,
        visitId,
        input,
        context,
        now,
        true,
      )
    ).visit,
  );
}

export async function updateMonthlyVisitWithWorkItems(
  pool: Pool,
  customerId: string,
  contractId: string,
  visitId: string,
  rawInput: UpdateVisitWithWorkItemsInput,
  context: ContractWriteContext,
): Promise<MonthlyVisitWorkItemUpdate> {
  assertVisitWriteIdentifiers(customerId, contractId, visitId, context.actorId);
  const input = updateVisitWithWorkItemsInputSchema.parse(rawInput);
  const operationDate = context.now ?? new Date();
  const now = toUtcDateTime6(operationDate);

  return withUtcTransaction(pool, async (connection) => {
    const { contract, visit } = await updateMonthlyVisitInTransaction(
      connection,
      customerId,
      contractId,
      visitId,
      input,
      context,
      now,
      true,
    );
    const tasks: WorkTask[] = [];

    if (input.workItems.length > 0) {
      if (input.deliveredOn === null) {
        throw new Error("Visit work items require a delivery date.");
      }
      const existingWorkItems = await listVisitWorkItemReferences(
        connection,
        visitId,
      );
      const linkedTaskIds = new Set(
        existingWorkItems.map((item) => item.taskId),
      );

      for (const workItem of input.workItems) {
        const taskId = typeof workItem === "string" ? null : workItem.id;
        const title = typeof workItem === "string" ? workItem : workItem.title;
        if (taskId !== null && linkedTaskIds.has(taskId)) continue;
        if (
          taskId !== null &&
          (await findTaskStateForUpdate(connection, taskId)) !== null
        ) {
          throw new VisitWorkItemIdentityConflictError();
        }

        let task: WorkTask;
        try {
          const taskInput = {
            customerId,
            description: null,
            dueOn: input.deliveredOn,
            priority: "normal" as const,
            projectId: contract.projectId,
            status: "done" as const,
            title,
          };
          task =
            taskId === null
              ? await createTaskInTransaction(
                  connection,
                  taskInput,
                  { ...context, now: operationDate },
                )
              : await createTaskInTransaction(
                  connection,
                  taskInput,
                  { ...context, now: operationDate },
                  taskId,
                );
          await insertTaskVisitRecord(connection, task.id, visitId, now);
        } catch (error) {
          if (taskId !== null && isDuplicateEntry(error)) {
            throw new VisitWorkItemIdentityConflictError();
          }
          throw error;
        }
        linkedTaskIds.add(task.id);
        await appendAuditEvent(connection, {
          action: "work_task.visit_linked",
          actorId: context.actorId,
          actorType: "user",
          afterSummary: { contractId, customerId, visitId },
          correlationId: context.correlationId,
          entityId: task.id,
          entityType: "work_task",
          occurredAtUtc: now,
        });
        tasks.push(task);
      }
    }

    return { tasks, visit };
  });
}
