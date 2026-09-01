import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import { findCustomerForUpdate } from "@/features/customers/repository";
import { summarizeVisitMonth } from "@/features/contracts/month-summary";
import {
  deletePlannedMonthVisits,
  findOverlappingContract,
  findOwnedContractForUpdate,
  findOwnedVisitForUpdate,
  insertContractRecord,
  insertVisitRecords,
  type ConsultingContract,
  listContractRecords,
  listMonthVisitRecords,
  type MonthlyVisit,
  updateVisitRecord,
} from "@/features/contracts/repository";
import {
  type CreateContractInput,
  createContractInputSchema,
  type MonthlyVisitPlanInput,
  monthParameterSchema,
  monthlyVisitPlanInputSchema,
  type UpdateVisitResolutionInput,
  updateVisitResolutionInputSchema,
} from "@/features/contracts/validation";
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

export class ContractClosedError extends Error {
  constructor() {
    super("The contract is not active.");
    this.name = "ContractClosedError";
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

export type ContractWriteContext = Readonly<{
  correlationId: string;
  now?: Date;
}>;

export type MonthlyVisitPlan = Readonly<{
  contractId: string;
  month: string;
  summary: ReturnType<typeof summarizeVisitMonth>;
  visits: readonly MonthlyVisit[];
}>;

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
    customerId: contract.customerId,
    endsOn: contract.endsOn,
    monthlyFeeAmount: contract.monthlyFeeAmount,
    paymentDay: contract.paymentDay,
    startsOn: contract.startsOn,
    status: contract.status,
    vatMode: contract.vatMode,
    vatRate: contract.vatRate,
  };
}

function planAuditSummary(month: string, visits: readonly MonthlyVisit[]) {
  return {
    committedOn: visits.map((visit) => visit.committedOn),
    month,
    visitCount: visits.length,
  };
}

function visitAuditSummary(visit: MonthlyVisit) {
  return {
    committedOn: visit.committedOn,
    deliveredOn: visit.deliveredOn,
    resolutionStatus: visit.resolutionStatus,
  };
}

function samePlannedVisits(
  existing: readonly MonthlyVisit[],
  requested: readonly MonthlyVisit[],
): boolean {
  if (existing.length !== requested.length) return false;
  return existing.every((visit, index) => {
    const other = requested[index];
    return (
      other !== undefined &&
      visit.committedOn === other.committedOn &&
      visit.internalPlannedAtUtc === other.internalPlannedAtUtc &&
      visit.internalDurationMinutes === other.internalDurationMinutes &&
      visit.resolutionStatus === "planned"
    );
  });
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
  const input = createContractInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const customer = await findCustomerForUpdate(connection, customerId);
    if (!customer) throw new ContractResourceNotFoundError();
    if (customer.status !== "active") throw new ContractCustomerInactiveError();

    if (
      input.status !== "closed" &&
      (await findOverlappingContract(
        connection,
        customerId,
        input.startsOn,
        input.endsOn,
      ))
    ) {
      throw new ContractPeriodConflictError();
    }

    const contract: ConsultingContract = {
      createdAtUtc: now,
      currency: "TRY",
      customerId,
      endsOn: input.endsOn,
      id: randomUUID(),
      internalNote: input.internalNote,
      monthlyFeeAmount: input.monthlyFeeAmount,
      paymentDay: input.paymentDay,
      startsOn: input.startsOn,
      status: input.status,
      updatedAtUtc: now,
      vatMode: input.vatMode,
      vatRate: input.vatRate,
    };

    await insertContractRecord(connection, contract);
    await appendAuditEvent(connection, {
      action: "consulting_contract.created",
      actorType: "user",
      afterSummary: contractAuditSummary(contract),
      correlationId: context.correlationId,
      entityId: contract.id,
      entityType: "consulting_contract",
      occurredAtUtc: now,
    });
    return contract;
  });
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
    if (existing.some((visit) => visit.resolutionStatus !== "planned")) {
      throw new MonthPlanLockedError();
    }

    const requested: MonthlyVisit[] = input.visits
      .map((visit) => ({
        committedOn: visit.committedOn,
        contractId,
        createdAtUtc: now,
        deliveredOn: null,
        id: randomUUID(),
        internalDurationMinutes: visit.internalDurationMinutes,
        internalPlannedAtUtc: localPlanDateTimeToUtc(
          visit.committedOn,
          visit.internalStartTime,
        ),
        resolutionNote: null,
        resolutionStatus: "planned" as const,
        updatedAtUtc: now,
      }))
      .sort((left, right) => left.committedOn.localeCompare(right.committedOn));

    if (samePlannedVisits(existing, requested)) {
      return monthlyPlan(contractId, month, existing);
    }

    await deletePlannedMonthVisits(
      connection,
      contractId,
      monthStart,
      nextMonthStart,
    );
    await insertVisitRecords(connection, requested);
    await appendAuditEvent(connection, {
      action: "monthly_visit_plan.replaced",
      actorType: "user",
      afterSummary: planAuditSummary(month, requested),
      beforeSummary: planAuditSummary(month, existing),
      correlationId: context.correlationId,
      entityId: contractId,
      entityType: "consulting_contract",
      occurredAtUtc: now,
    });
    return monthlyPlan(contractId, month, requested);
  });
}

export async function updateMonthlyVisit(
  pool: Pool,
  customerId: string,
  contractId: string,
  visitId: string,
  rawInput: UpdateVisitResolutionInput,
  context: ContractWriteContext,
): Promise<MonthlyVisit> {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(contractId);
  assertCanonicalUuid(visitId);
  const input = updateVisitResolutionInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const contract = await findOwnedContractForUpdate(
      connection,
      customerId,
      contractId,
    );
    if (!contract) throw new ContractResourceNotFoundError();
    if (contract.status !== "active") throw new ContractClosedError();

    const before = await findOwnedVisitForUpdate(
      connection,
      contractId,
      visitId,
    );
    if (!before) throw new ContractResourceNotFoundError();
    if (
      before.resolutionStatus === "completed" ||
      before.resolutionStatus === "cancelled_by_agreement"
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
      actorType: "user",
      afterSummary: visitAuditSummary(after),
      beforeSummary: visitAuditSummary(before),
      correlationId: context.correlationId,
      entityId: visitId,
      entityType: "monthly_visit_commitment",
      occurredAtUtc: now,
    });
    return after;
  });
}
