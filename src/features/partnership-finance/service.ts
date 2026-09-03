import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool, PoolConnection } from "mysql2/promise";

import { istanbulDate } from "@/features/finance/period";
import { findProjectForUpdate } from "@/features/projects/repository";
import {
  ContributionMonthCollisionError,
  findCommissionByOperationKeyForUpdate,
  findCommissionForUpdate,
  findContributionByOperationKeyForUpdate,
  findContributionByProjectMonthForUpdate,
  findContributionReceiptByOperationKeyForUpdate,
  findContributionForUpdate,
  insertCommissionRecordIdempotently,
  insertContributionRecordIdempotently,
  insertContributionReceiptIdempotently,
  listCommissionRecords,
  listContributionRecords,
  listContributionReceiptRecords,
  type CommissionContributionMode,
  type CommissionStatus,
  type ContributionStatus,
  type PartnershipCommission,
  type PartnershipContribution,
  type PartnershipContributionReceipt,
  updateCommissionRecord,
  updateContributionRecord,
} from "./repository";
import {
  type CreateCommissionInput,
  type CreateContributionInput,
  type CreateContributionReceiptInput,
  createCommissionInputSchema,
  createContributionInputSchema,
  createContributionReceiptInputSchema,
  type PartnershipListFilter,
  partnershipListFilterSchema,
  type UpdateCommissionInput,
  type UpdateContributionInput,
  updateCommissionInputSchema,
  updateContributionInputSchema,
} from "./validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class PartnershipProjectNotFoundError extends Error {
  constructor() {
    super("Partnership project was not found.");
    this.name = "PartnershipProjectNotFoundError";
  }
}

export class PartnershipProjectTypeError extends Error {
  constructor() {
    super("Selected project is not a partnership project.");
    this.name = "PartnershipProjectTypeError";
  }
}

export class PartnershipRecordNotFoundError extends Error {
  constructor() {
    super("Partnership finance record was not found.");
    this.name = "PartnershipRecordNotFoundError";
  }
}

export class PartnershipVersionConflictError extends Error {
  constructor() {
    super("Partnership finance record was changed by another request.");
    this.name = "PartnershipVersionConflictError";
  }
}

export class PartnershipIdempotencyConflictError extends Error {
  constructor() {
    super("Operation key belongs to a different partnership record.");
    this.name = "PartnershipIdempotencyConflictError";
  }
}

export class PartnershipContributionMonthConflictError extends Error {
  constructor() {
    super("A contribution already exists for this project and month.");
    this.name = "PartnershipContributionMonthConflictError";
  }
}

export class PartnershipContributionClosedError extends Error {
  constructor() {
    super("Cancelled or fully received contribution cannot accept a receipt.");
    this.name = "PartnershipContributionClosedError";
  }
}

export class PartnershipContributionOverpaymentError extends Error {
  constructor() {
    super("Contribution receipt exceeds the outstanding amount.");
    this.name = "PartnershipContributionOverpaymentError";
  }
}

export class PartnershipStatusTransitionError extends Error {
  constructor() {
    super("Partnership finance status transition is not allowed.");
    this.name = "PartnershipStatusTransitionError";
  }
}

export class PartnershipRecordLockedError extends Error {
  constructor() {
    super("Earned or received partnership finance values are locked.");
    this.name = "PartnershipRecordLockedError";
  }
}

export class PartnershipFutureActualDateError extends Error {
  constructor() {
    super("An actual collection or payment date cannot be in the future.");
    this.name = "PartnershipFutureActualDateError";
  }
}

export type PartnershipWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

function assertActualDatesNotFuture(
  today: string,
  ...values: readonly (string | null)[]
): void {
  if (values.some((value) => value !== null && value > today)) {
    throw new PartnershipFutureActualDateError();
  }
}

const RATE_BY_MODE: Readonly<Record<CommissionContributionMode, string>> = {
  partner_only: "0.1000",
  user_both: "0.5000",
  user_one_side: "0.2500",
};

async function assertPartnershipProject(
  connection: PoolConnection,
  projectId: string,
): Promise<Readonly<{ displayName: string; shortCode: string }>> {
  const project = await findProjectForUpdate(connection, projectId);
  if (!project) throw new PartnershipProjectNotFoundError();
  if (project.projectType !== "partnership") throw new PartnershipProjectTypeError();
  return project;
}

function commissionShare(
  basisAmount: string,
  mode: CommissionContributionMode,
): Readonly<{ shareAmount: string; shareRate: string }> {
  const shareRate = RATE_BY_MODE[mode];
  return {
    shareAmount: new Decimal(basisAmount).times(shareRate).toDecimalPlaces(4).toFixed(4),
    shareRate,
  };
}

function commissionSummary(record: PartnershipCommission) {
  return {
    agencyCollectedOn: record.agencyCollectedOn,
    closedOn: record.closedOn,
    commissionBasisAmount: record.commissionBasisAmount,
    contributionMode: record.contributionMode,
    description: record.description,
    paidOn: record.paidOn,
    projectId: record.projectId,
    shareAmount: record.shareAmount,
    shareRate: record.shareRate,
    status: record.status,
    transactionType: record.transactionType,
    version: record.version,
  };
}

function contributionSummary(record: PartnershipContribution) {
  return {
    contributionMonth: record.contributionMonth,
    description: record.description,
    dueOn: record.dueOn,
    expectedAmount: record.expectedAmount,
    projectId: record.projectId,
    receivedAmount: record.receivedAmount,
    receivedOn: record.receivedOn,
    status: record.status,
    version: record.version,
  };
}

function commissionCreateMatches(
  stored: PartnershipCommission,
  input: ReturnType<typeof createCommissionInputSchema.parse>,
): boolean {
  const share = commissionShare(input.commissionBasisAmount, input.contributionMode);
  return (
    stored.projectId === input.projectId &&
    stored.transactionType === input.transactionType &&
    stored.description === input.description &&
    stored.closedOn === input.closedOn &&
    stored.commissionBasisAmount === input.commissionBasisAmount &&
    stored.contributionMode === input.contributionMode &&
    stored.shareRate === share.shareRate &&
    stored.shareAmount === share.shareAmount &&
    stored.status === input.status &&
    stored.agencyCollectedOn === input.agencyCollectedOn &&
    stored.paidOn === input.paidOn &&
    stored.note === input.note
  );
}

function contributionCreateMatches(
  stored: PartnershipContribution,
  input: ReturnType<typeof createContributionInputSchema.parse>,
): boolean {
  return (
    stored.projectId === input.projectId &&
    stored.contributionMonth === input.contributionMonth &&
    stored.description === input.description &&
    stored.expectedAmount === input.expectedAmount &&
    stored.dueOn === input.dueOn &&
    stored.receivedAmount === "0.0000" &&
    stored.receivedOn === null &&
    stored.status === "expected" &&
    stored.note === input.note
  );
}

function receiptCreateMatches(
  stored: PartnershipContributionReceipt,
  contributionId: string,
  input: ReturnType<typeof createContributionReceiptInputSchema.parse>,
): boolean {
  return (
    stored.contributionId === contributionId &&
    stored.amount === input.amount &&
    stored.receivedOn === input.receivedOn &&
    stored.note === input.note
  );
}

function allowedCommissionTransition(before: CommissionStatus, after: CommissionStatus): boolean {
  if (before === "expected") return true;
  if (before === "agency_collected") return after === "agency_collected" || after === "paid";
  return before === after;
}

function allowedContributionTransition(before: ContributionStatus, after: ContributionStatus): boolean {
  if (before === "expected") return after === "expected" || after === "cancelled";
  return before === after;
}

function assertCommissionUnlocked(
  before: PartnershipCommission,
  after: Omit<PartnershipCommission, "createdAtUtc" | "id" | "projectName" | "projectShortCode" | "updatedAtUtc" | "version" | "clientOperationKey">,
): void {
  if (before.status === "expected") return;
  if (
    before.projectId !== after.projectId ||
    before.transactionType !== after.transactionType ||
    before.closedOn !== after.closedOn ||
    before.commissionBasisAmount !== after.commissionBasisAmount ||
    before.contributionMode !== after.contributionMode ||
    before.shareRate !== after.shareRate ||
    before.shareAmount !== after.shareAmount
  ) {
    throw new PartnershipRecordLockedError();
  }
}

function assertContributionUnlocked(
  before: PartnershipContribution,
  after: Omit<PartnershipContribution, "createdAtUtc" | "id" | "projectName" | "projectShortCode" | "updatedAtUtc" | "version" | "clientOperationKey">,
): void {
  if (before.status === "expected") return;
  if (
    before.projectId !== after.projectId ||
    before.contributionMonth !== after.contributionMonth ||
    before.expectedAmount !== after.expectedAmount
  ) {
    throw new PartnershipRecordLockedError();
  }
}

export async function listPartnershipCommissions(
  pool: Pool,
  rawFilters: PartnershipListFilter,
) {
  const filters = partnershipListFilterSchema.parse(rawFilters);
  const commissions = await withUtcTransaction(pool, (connection) =>
    listCommissionRecords(connection, filters),
  );
  const sum = (statuses: readonly CommissionStatus[]) =>
    commissions
      .filter((record) => statuses.includes(record.status))
      .reduce((total, record) => total.plus(record.shareAmount), new Decimal(0))
      .toFixed(4);
  return {
    commissions,
    summary: {
      earnedUnpaidAmount: sum(["agency_collected"]),
      expectedAmount: sum(["expected"]),
      paidAmount: sum(["paid"]),
    },
  };
}

export async function createPartnershipCommission(
  pool: Pool,
  rawInput: CreateCommissionInput,
  context: PartnershipWriteContext,
): Promise<Readonly<{ commission: PartnershipCommission; created: boolean }>> {
  const input = createCommissionInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  assertActualDatesNotFuture(istanbulDate(nowDate), input.agencyCollectedOn, input.paidOn);
  const now = toUtcDateTime6(nowDate);
  return withUtcTransaction(pool, async (connection) => {
    const duplicate = await findCommissionByOperationKeyForUpdate(connection, input.clientOperationKey);
    if (duplicate) {
      if (!commissionCreateMatches(duplicate, input)) throw new PartnershipIdempotencyConflictError();
      return { commission: duplicate, created: false };
    }
    const selectedProject = await assertPartnershipProject(connection, input.projectId);
    const share = commissionShare(input.commissionBasisAmount, input.contributionMode);
    const pending: PartnershipCommission = {
      ...input,
      ...share,
      createdAtUtc: now,
      id: randomUUID(),
      projectName: selectedProject.displayName,
      projectShortCode: selectedProject.shortCode,
      updatedAtUtc: now,
      version: 1,
    };
    const commission = await insertCommissionRecordIdempotently(connection, pending);
    if (!commissionCreateMatches(commission, input)) throw new PartnershipIdempotencyConflictError();
    await appendAuditEvent(connection, {
      action: "partnership_commission.created",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: commissionSummary(commission),
      correlationId: context.correlationId,
      entityId: commission.id,
      entityType: "partnership_commission",
      occurredAtUtc: now,
    });
    return { commission, created: true };
  });
}

export async function updatePartnershipCommission(
  pool: Pool,
  id: string,
  rawInput: UpdateCommissionInput,
  context: PartnershipWriteContext,
): Promise<PartnershipCommission> {
  assertCanonicalUuid(id);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = updateCommissionInputSchema.parse(rawInput);
  const nowDate = context.now ?? new Date();
  assertActualDatesNotFuture(istanbulDate(nowDate), input.agencyCollectedOn, input.paidOn);
  const now = toUtcDateTime6(nowDate);
  return withUtcTransaction(pool, async (connection) => {
    const before = await findCommissionForUpdate(connection, id);
    if (!before) throw new PartnershipRecordNotFoundError();
    if (before.version !== input.version) throw new PartnershipVersionConflictError();
    if (!allowedCommissionTransition(before.status, input.status)) throw new PartnershipStatusTransitionError();
    const selectedProject = await assertPartnershipProject(connection, input.projectId);
    const share = commissionShare(input.commissionBasisAmount, input.contributionMode);
    const { version: expectedVersion, ...changes } = input;
    assertCommissionUnlocked(before, { ...changes, ...share });
    const after: PartnershipCommission = {
      ...before,
      ...changes,
      ...share,
      projectName: selectedProject.displayName,
      projectShortCode: selectedProject.shortCode,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateCommissionRecord(connection, after, expectedVersion))) {
      throw new PartnershipVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: "partnership_commission.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: commissionSummary(after),
      beforeSummary: commissionSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "partnership_commission",
      occurredAtUtc: now,
    });
    return after;
  });
}

export async function listPartnershipContributions(
  pool: Pool,
  rawFilters: PartnershipListFilter,
) {
  const filters = partnershipListFilterSchema.parse(rawFilters);
  const { contributions, receipts } = await withUtcTransaction(pool, async (connection) => ({
    contributions: await listContributionRecords(connection, filters),
    receipts: await listContributionReceiptRecords(connection, filters),
  }));
  const totals = contributions.reduce(
    (value, record) => {
      if (record.status !== "cancelled") {
        value.expected = value.expected.plus(record.expectedAmount);
        value.received = value.received.plus(record.receivedAmount);
      }
      return value;
    },
    { expected: new Decimal(0), received: new Decimal(0) },
  );
  return {
    contributions: contributions.map((contribution) => ({
      ...contribution,
      receipts: receipts.filter((receipt) => receipt.contributionId === contribution.id),
    })),
    summary: {
      outstandingAmount: totals.expected.minus(totals.received).toFixed(4),
      receivedAmount: totals.received.toFixed(4),
    },
  };
}

export async function createPartnershipContribution(
  pool: Pool,
  rawInput: CreateContributionInput,
  context: PartnershipWriteContext,
): Promise<Readonly<{ contribution: PartnershipContribution; created: boolean }>> {
  const input = createContributionInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const duplicate = await findContributionByOperationKeyForUpdate(connection, input.clientOperationKey);
    if (duplicate) {
      if (!contributionCreateMatches(duplicate, input)) throw new PartnershipIdempotencyConflictError();
      return { contribution: duplicate, created: false };
    }
    if (await findContributionByProjectMonthForUpdate(connection, input.projectId, input.contributionMonth)) {
      throw new PartnershipContributionMonthConflictError();
    }
    const selectedProject = await assertPartnershipProject(connection, input.projectId);
    const contribution: PartnershipContribution = {
      ...input,
      createdAtUtc: now,
      id: randomUUID(),
      projectName: selectedProject.displayName,
      projectShortCode: selectedProject.shortCode,
      receivedAmount: "0.0000",
      receivedOn: null,
      status: "expected",
      updatedAtUtc: now,
      version: 1,
    };
    try {
      const stored = await insertContributionRecordIdempotently(connection, contribution);
      if (!contributionCreateMatches(stored, input)) throw new PartnershipIdempotencyConflictError();
      await appendAuditEvent(connection, {
        action: "partnership_contribution.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: contributionSummary(stored),
        correlationId: context.correlationId,
        entityId: stored.id,
        entityType: "partnership_contribution",
        occurredAtUtc: now,
      });
      return { contribution: stored, created: true };
    } catch (error) {
      if (error instanceof ContributionMonthCollisionError || isDuplicateEntry(error)) {
        throw new PartnershipContributionMonthConflictError();
      }
      throw error;
    }
  });
}

export async function updatePartnershipContribution(
  pool: Pool,
  id: string,
  rawInput: UpdateContributionInput,
  context: PartnershipWriteContext,
): Promise<PartnershipContribution> {
  assertCanonicalUuid(id);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = updateContributionInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const before = await findContributionForUpdate(connection, id);
    if (!before) throw new PartnershipRecordNotFoundError();
    if (before.version !== input.version) throw new PartnershipVersionConflictError();
    if (!allowedContributionTransition(before.status, input.status)) throw new PartnershipStatusTransitionError();
    const selectedProject = await assertPartnershipProject(connection, input.projectId);
    const { version: expectedVersion, ...changes } = input;
    assertContributionUnlocked(before, { ...before, ...changes });
    if (
      (before.projectId !== input.projectId || before.contributionMonth !== input.contributionMonth) &&
      (await findContributionByProjectMonthForUpdate(connection, input.projectId, input.contributionMonth))
    ) {
      throw new PartnershipContributionMonthConflictError();
    }
    const after: PartnershipContribution = {
      ...before,
      ...changes,
      projectName: selectedProject.displayName,
      projectShortCode: selectedProject.shortCode,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    try {
      if (!(await updateContributionRecord(connection, after, expectedVersion))) {
        throw new PartnershipVersionConflictError();
      }
    } catch (error) {
      if (error instanceof ContributionMonthCollisionError || isDuplicateEntry(error)) {
        throw new PartnershipContributionMonthConflictError();
      }
      throw error;
    }
    await appendAuditEvent(connection, {
      action: "partnership_contribution.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: contributionSummary(after),
      beforeSummary: contributionSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "partnership_contribution",
      occurredAtUtc: now,
    });
    return after;
  });
}

export async function createPartnershipContributionReceipt(
  pool: Pool,
  contributionId: string,
  rawInput: CreateContributionReceiptInput,
  context: PartnershipWriteContext,
): Promise<Readonly<{
  contribution: PartnershipContribution;
  created: boolean;
  receipt: PartnershipContributionReceipt;
}>> {
  assertCanonicalUuid(contributionId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = createContributionReceiptInputSchema.parse(rawInput);
  const nowDate = context.now ?? new Date();
  assertActualDatesNotFuture(istanbulDate(nowDate), input.receivedOn);
  const now = toUtcDateTime6(nowDate);
  return withUtcTransaction(pool, async (connection) => {
    const duplicate = await findContributionReceiptByOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (duplicate) {
      if (!receiptCreateMatches(duplicate, contributionId, input)) {
        throw new PartnershipIdempotencyConflictError();
      }
      const contribution = await findContributionForUpdate(connection, contributionId);
      if (!contribution) throw new PartnershipRecordNotFoundError();
      return { contribution, created: false, receipt: duplicate };
    }

    const before = await findContributionForUpdate(connection, contributionId);
    if (!before) throw new PartnershipRecordNotFoundError();
    if (before.status === "cancelled" || before.status === "received") {
      throw new PartnershipContributionClosedError();
    }
    const receivedAmount = new Decimal(before.receivedAmount).plus(input.amount);
    if (receivedAmount.greaterThan(before.expectedAmount)) {
      throw new PartnershipContributionOverpaymentError();
    }
    const pending: PartnershipContributionReceipt = {
      ...input,
      contributionId,
      createdAtUtc: now,
      id: randomUUID(),
    };
    const receipt = await insertContributionReceiptIdempotently(connection, pending);
    if (!receiptCreateMatches(receipt, contributionId, input)) {
      throw new PartnershipIdempotencyConflictError();
    }
    if (receipt.id !== pending.id) {
      const contribution = await findContributionForUpdate(connection, contributionId);
      if (!contribution) throw new PartnershipRecordNotFoundError();
      return { contribution, created: false, receipt };
    }

    const after: PartnershipContribution = {
      ...before,
      receivedAmount: receivedAmount.toFixed(4),
      receivedOn:
        before.receivedOn === null || before.receivedOn < input.receivedOn
          ? input.receivedOn
          : before.receivedOn,
      status: receivedAmount.equals(before.expectedAmount) ? "received" : "partial",
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateContributionRecord(connection, after, before.version))) {
      throw new PartnershipVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: "partnership_contribution.receipt_added",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: {
        amount: receipt.amount,
        contribution: contributionSummary(after),
        contributionId,
        receivedOn: receipt.receivedOn,
      },
      beforeSummary: contributionSummary(before),
      correlationId: context.correlationId,
      entityId: receipt.id,
      entityType: "partnership_contribution_receipt",
      occurredAtUtc: now,
    });
    return { contribution: after, created: true, receipt };
  });
}
