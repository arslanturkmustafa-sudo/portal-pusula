import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool } from "mysql2/promise";

import {
  findActiveCustomerProjectForUpdate,
  findCustomerForUpdate,
} from "@/features/customers/repository";
import {
  createFinanceTransactionInConnection,
  reverseFinanceTransactionInConnection,
} from "@/features/finance/account-service";
import {
  addMoney,
  contractMoneySnapshot,
  openingBalanceMoneySnapshot,
  proratedContractFee,
  receivableStatus,
  remainingAmount,
  type ReceivableStatus,
} from "@/features/finance/money";
import {
  dueDateForMonth,
  istanbulDate,
  monthBounds,
  monthIntersectsPeriod,
} from "@/features/finance/period";
import {
  findCollectionByClientOperationKeyForUpdate,
  findCollectionForUpdate,
  findCollectionReversalForUpdate,
  findFinanceContractForUpdate,
  findGeneratedReceivableForUpdate,
  findReceivableForUpdate,
  insertCollectionRecordIdempotently,
  insertOpeningBalanceRecordIdempotently,
  insertReceivableRecord,
  listReceivableCollectionMovements,
  listReceivableRecords,
  type NewReceivableRecord,
  type ReceivableCollection,
  type ReceivableCollectionMovement,
  type ReceivableRecord,
  updateReceivableLifecycleRecord,
} from "@/features/finance/repository";
import {
  type CreateCollectionInput,
  createCollectionInputSchema,
  type FinanceReceivableListFilter,
  financeReceivableListFilterSchema,
  type GenerateReceivableInput,
  generateReceivableInputSchema,
  type OpeningBalanceInput,
  openingBalanceInputSchema,
  type ReceivableLifecycleInput,
  receivableLifecycleInputSchema,
  type ReverseCollectionInput,
  reverseCollectionInputSchema,
} from "@/features/finance/validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class FinanceResourceNotFoundError extends Error {
  constructor() {
    super("The requested finance resource was not found.");
    this.name = "FinanceResourceNotFoundError";
  }
}

export class FinanceCustomerProjectUnavailableError extends Error {
  constructor() {
    super("The project is not an active project for this customer.");
    this.name = "FinanceCustomerProjectUnavailableError";
  }
}

export class ContractNotBillableError extends Error {
  constructor() {
    super("The contract cannot generate a receivable.");
    this.name = "ContractNotBillableError";
  }
}

export class FinanceContractProjectMissingError extends Error {
  constructor() {
    super("The contract must be assigned to a project before billing.");
    this.name = "FinanceContractProjectMissingError";
  }
}

export class FinanceMonthOutsideContractError extends Error {
  constructor() {
    super("The requested month is outside the contract period.");
    this.name = "FinanceMonthOutsideContractError";
  }
}

export class CollectionExceedsOutstandingError extends Error {
  constructor() {
    super("The collection exceeds the outstanding amount.");
    this.name = "CollectionExceedsOutstandingError";
  }
}

export class CollectionDateInFutureError extends Error {
  constructor() {
    super("The collection date cannot be in the future.");
    this.name = "CollectionDateInFutureError";
  }
}

export class CollectionAccountPermissionError extends Error {
  constructor() {
    super("Collection account movements require finance account permissions.");
    this.name = "CollectionAccountPermissionError";
  }
}

export class FinanceIdempotencyConflictError extends Error {
  constructor() {
    super("The client operation key is already bound to another request.");
    this.name = "FinanceIdempotencyConflictError";
  }
}

export class ReceivableAlreadyVoidedError extends Error {
  constructor() {
    super("The receivable is already voided.");
    this.name = "ReceivableAlreadyVoidedError";
  }
}

export class ReceivableHasCollectionsError extends Error {
  constructor() {
    super("A receivable with net collections cannot be voided.");
    this.name = "ReceivableHasCollectionsError";
  }
}

export class FinanceVersionConflictError extends Error {
  constructor() {
    super("The finance record was changed by another request.");
    this.name = "FinanceVersionConflictError";
  }
}

export class CollectionNotReversibleError extends Error {
  constructor() {
    super("The selected entry is not an original collection.");
    this.name = "CollectionNotReversibleError";
  }
}

export class CollectionAlreadyReversedError extends Error {
  constructor() {
    super("The collection already has a reversal entry.");
    this.name = "CollectionAlreadyReversedError";
  }
}

export type FinanceWriteContext = Readonly<{
  actorId?: string;
  canMutateAccountLedger?: boolean;
  correlationId: string;
  now?: Date;
}>;

export type ReceivableView = ReceivableRecord &
  Readonly<{
    outstandingAmount: string;
    status: ReceivableStatus | "voided";
  }>;

export type FinanceSummary = Readonly<{
  collectedThisMonth: string;
  dueThisMonth: string;
  outstanding: string;
  overdue: string;
  totalCollected: string;
  totalReceivable: string;
}>;

export type FinanceReceivables = Readonly<{
  receivables: readonly (ReceivableView &
    Readonly<{
      collections: readonly Omit<
        ReceivableCollectionMovement,
        "receivableId"
      >[];
    }>)[];
  summary: FinanceSummary;
}>;

function receivableView(
  record: ReceivableRecord,
  today: string,
): ReceivableView {
  if (record.recordState === "voided") {
    return { ...record, outstandingAmount: "0.0000", status: "voided" };
  }
  return {
    ...record,
    outstandingAmount: remainingAmount(
      record.totalAmount,
      record.collectedAmount,
    ),
    status: receivableStatus(
      record.totalAmount,
      record.collectedAmount,
      record.dueOn,
      today,
    ),
  };
}

function receivableAuditSummary(receivable: ReceivableRecord) {
  return {
    contractId: receivable.contractId,
    customerId: receivable.customerId,
    dueOn: receivable.dueOn,
    netAmount: receivable.netAmount,
    periodMonth: receivable.periodMonth,
    projectId: receivable.projectId,
    recordState: receivable.recordState,
    sourceType: receivable.sourceType,
    totalAmount: receivable.totalAmount,
    vatAmount: receivable.vatAmount,
    version: receivable.version,
  };
}

function openingBalanceMatches(
  persisted: ReceivableRecord,
  pending: NewReceivableRecord,
): boolean {
  return (
    persisted.contractId === null &&
    persisted.currency === pending.currency &&
    persisted.customerId === pending.customerId &&
    persisted.description === pending.description &&
    persisted.dueOn === pending.dueOn &&
    persisted.netAmount === pending.netAmount &&
    persisted.periodMonth === null &&
    persisted.projectId === pending.projectId &&
    persisted.sourceType === "opening_balance" &&
    persisted.totalAmount === pending.totalAmount &&
    persisted.vatAmount === pending.vatAmount
  );
}

function collectionMatches(
  persisted: ReceivableCollection,
  input: CreateCollectionInput,
): boolean {
  return (
    persisted.amount === input.amount &&
    persisted.clientOperationKey === input.clientOperationKey &&
    persisted.collectedOn === input.collectedOn &&
    persisted.entryType === "collection" &&
    persisted.note === input.note &&
    persisted.receivableId === input.receivableId &&
    persisted.reversalOfId === null &&
    persisted.reversalReason === null &&
    persisted.financeTransactionId !== null &&
    persisted.targetAccountId === input.targetAccountId
  );
}

function reversalMatches(
  persisted: ReceivableCollection,
  originalCollectionId: string,
  input: ReverseCollectionInput,
): boolean {
  return (
    persisted.clientOperationKey === input.clientOperationKey &&
    persisted.entryType === "reversal" &&
    persisted.reversalOfId === originalCollectionId &&
    persisted.reversalReason === input.reason
  );
}

export function listFinanceReceivables(
  pool: Pool,
  now?: Date,
): Promise<FinanceReceivables>;
export function listFinanceReceivables(
  pool: Pool,
  rawFilters?: FinanceReceivableListFilter,
  now?: Date,
): Promise<FinanceReceivables>;
export async function listFinanceReceivables(
  pool: Pool,
  rawFiltersOrNow: FinanceReceivableListFilter | Date = {},
  requestedNow = new Date(),
): Promise<FinanceReceivables> {
  const filters = financeReceivableListFilterSchema.parse(
    rawFiltersOrNow instanceof Date ? {} : rawFiltersOrNow,
  );
  const now =
    rawFiltersOrNow instanceof Date ? rawFiltersOrNow : requestedNow;
  const today = istanbulDate(now);
  const month = today.slice(0, 7);
  const { monthStart, nextMonthStart } = monthBounds(month);

  return withUtcTransaction(pool, async (connection) => {
    const snapshot = await listReceivableRecords(
      connection,
      monthStart,
      nextMonthStart,
      filters.projectId,
    );
    const movements = await listReceivableCollectionMovements(
      connection,
      filters.projectId,
    );
    const movementsByReceivable = new Map<
      string,
      Omit<ReceivableCollectionMovement, "receivableId">[]
    >();
    for (const movement of movements) {
      const { receivableId, ...view } = movement;
      const grouped = movementsByReceivable.get(receivableId) ?? [];
      grouped.push(view);
      movementsByReceivable.set(receivableId, grouped);
    }
    const receivables = snapshot.receivables.map((record) => ({
      ...receivableView(record, today),
      collections: movementsByReceivable.get(record.id) ?? [],
    }));
    let totalReceivable = "0.0000";
    let totalCollected = "0.0000";
    let outstanding = "0.0000";
    let overdue = "0.0000";
    let dueThisMonth = "0.0000";

    for (const receivable of receivables) {
      if (receivable.recordState === "voided") continue;
      totalReceivable = addMoney(totalReceivable, receivable.totalAmount);
      totalCollected = addMoney(totalCollected, receivable.collectedAmount);
      outstanding = addMoney(outstanding, receivable.outstandingAmount);
      if (receivable.status === "overdue") {
        overdue = addMoney(overdue, receivable.outstandingAmount);
      }
      if (
        receivable.dueOn >= monthStart &&
        receivable.dueOn < nextMonthStart
      ) {
        dueThisMonth = addMoney(dueThisMonth, receivable.outstandingAmount);
      }
    }

    return {
      receivables,
      summary: {
        collectedThisMonth: new Decimal(
          snapshot.collectedAmountInRange,
        ).toFixed(4),
        dueThisMonth,
        outstanding,
        overdue,
        totalCollected,
        totalReceivable,
      },
    };
  });
}

export async function generateContractMonthReceivable(
  pool: Pool,
  rawInput: GenerateReceivableInput,
  context: FinanceWriteContext,
): Promise<Readonly<{ created: boolean; receivable: ReceivableView }>> {
  const input = generateReceivableInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);

  return withUtcTransaction(pool, async (connection) => {
    const contract = await findFinanceContractForUpdate(
      connection,
      input.contractId,
    );
    if (!contract) throw new FinanceResourceNotFoundError();
    if (contract.status !== "active") throw new ContractNotBillableError();
    if (contract.projectId === null) {
      throw new FinanceContractProjectMissingError();
    }
    if (!monthIntersectsPeriod(input.month, contract.startsOn, contract.endsOn)) {
      throw new FinanceMonthOutsideContractError();
    }

    const existing = await findGeneratedReceivableForUpdate(
      connection,
      contract.id,
      `${input.month}-01`,
    );
    if (existing) {
      return { created: false, receivable: receivableView(existing, today) };
    }

    const billableFee = proratedContractFee(
      contract.monthlyFeeAmount,
      input.month,
      contract.startsOn,
      contract.endsOn,
    );
    const snapshot = contractMoneySnapshot(
      billableFee,
      contract.vatMode,
      contract.vatRate,
    );
    const pending: NewReceivableRecord = {
      ...snapshot,
      clientOperationKey: null,
      contractId: contract.id,
      createdAtUtc: now,
      currency: "TRY",
      customerId: contract.customerId,
      description: `${input.month} aylık danışmanlık hizmeti`,
      dueOn: dueDateForMonth(input.month, contract.paymentDay),
      id: randomUUID(),
      periodMonth: input.month,
      projectId: contract.projectId,
      sourceType: "contract_month",
      updatedAtUtc: now,
    };
    await insertReceivableRecord(connection, pending);
    const created = await findGeneratedReceivableForUpdate(
      connection,
      contract.id,
      `${input.month}-01`,
    );
    if (!created) throw new Error("Created receivable could not be read.");
    await appendAuditEvent(connection, {
      action: "receivable.contract_month_generated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: receivableAuditSummary(created),
      correlationId: context.correlationId,
      entityId: created.id,
      entityType: "receivable",
      occurredAtUtc: now,
    });
    return { created: true, receivable: receivableView(created, today) };
  });
}

export async function createOpeningBalance(
  pool: Pool,
  rawInput: OpeningBalanceInput,
  context: FinanceWriteContext,
): Promise<Readonly<{ created: boolean; receivable: ReceivableView }>> {
  const input = openingBalanceInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);

  return withUtcTransaction(pool, async (connection) => {
    const customer = await findCustomerForUpdate(connection, input.customerId);
    if (!customer) throw new FinanceResourceNotFoundError();
    if (customer.status !== "active" || customer.archivedAtUtc !== null) {
      throw new FinanceCustomerProjectUnavailableError();
    }
    if (
      !(await findActiveCustomerProjectForUpdate(
        connection,
        input.customerId,
        input.projectId,
      ))
    ) {
      throw new FinanceCustomerProjectUnavailableError();
    }
    const snapshot = openingBalanceMoneySnapshot(
      input.netAmount,
      input.vatAmount,
    );
    const pending: NewReceivableRecord = {
      ...snapshot,
      clientOperationKey: input.clientOperationKey,
      contractId: null,
      createdAtUtc: now,
      currency: "TRY",
      customerId: customer.id,
      description: input.description,
      dueOn: input.dueOn,
      id: randomUUID(),
      periodMonth: null,
      projectId: input.projectId,
      sourceType: "opening_balance",
      updatedAtUtc: now,
    };
    const persisted = await insertOpeningBalanceRecordIdempotently(
      connection,
      pending,
    );
    if (!openingBalanceMatches(persisted, pending)) {
      throw new FinanceIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      await appendAuditEvent(connection, {
        action: "receivable.opening_balance_created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: receivableAuditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "receivable",
        occurredAtUtc: now,
      });
    }
    return { created, receivable: receivableView(persisted, today) };
  });
}

export async function createReceivableCollection(
  pool: Pool,
  rawInput: CreateCollectionInput,
  context: FinanceWriteContext,
): Promise<
  Readonly<{
    collection: ReceivableCollection;
    created: boolean;
    receivable: ReceivableView;
  }>
> {
  const input = createCollectionInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  if (context.canMutateAccountLedger !== true) {
    throw new CollectionAccountPermissionError();
  }
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);
  if (input.collectedOn > today) throw new CollectionDateInFutureError();

  return withUtcTransaction(pool, async (connection) => {
    const replay = await findCollectionByClientOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay) {
      if (!collectionMatches(replay, input)) {
        throw new FinanceIdempotencyConflictError();
      }
      const replayedReceivable = await findReceivableForUpdate(
        connection,
        replay.receivableId,
      );
      if (!replayedReceivable) throw new FinanceResourceNotFoundError();
      return {
        collection: replay,
        created: false,
        receivable: receivableView(replayedReceivable, today),
      };
    }

    const before = await findReceivableForUpdate(
      connection,
      input.receivableId,
    );
    if (!before) throw new FinanceResourceNotFoundError();
    if (before.recordState !== "active") throw new ReceivableAlreadyVoidedError();
    const replayAfterReceivableLock =
      await findCollectionByClientOperationKeyForUpdate(
        connection,
        input.clientOperationKey,
      );
    if (replayAfterReceivableLock) {
      if (!collectionMatches(replayAfterReceivableLock, input)) {
        throw new FinanceIdempotencyConflictError();
      }
      const replayedReceivable = await findReceivableForUpdate(
        connection,
        replayAfterReceivableLock.receivableId,
      );
      if (!replayedReceivable) throw new FinanceResourceNotFoundError();
      return {
        collection: replayAfterReceivableLock,
        created: false,
        receivable: receivableView(replayedReceivable, today),
      };
    }
    const collectedAmount = addMoney(before.collectedAmount, input.amount);
    if (new Decimal(collectedAmount).greaterThan(before.totalAmount)) {
      throw new CollectionExceedsOutstandingError();
    }

    const accountMovement = await createFinanceTransactionInConnection(
      connection,
      {
        amount: input.amount,
        clientOperationKey: input.clientOperationKey,
        description: `Tahsilat: ${before.customerName} · ${before.description}`.slice(
          0,
          191,
        ),
        occurredOn: input.collectedOn,
        sourceAccountId: null,
        targetAccountId: input.targetAccountId,
        transactionType: "income",
      },
      context,
    );
    if (accountMovement.transaction.targetAccount === null) {
      throw new Error("Collection account movement has no target account.");
    }

    const collection: ReceivableCollection = {
      amount: input.amount,
      clientOperationKey: input.clientOperationKey,
      collectedOn: input.collectedOn,
      createdAtUtc: now,
      entryType: "collection",
      financeTransactionId: accountMovement.transaction.id,
      id: randomUUID(),
      note: input.note,
      receivableId: before.id,
      reversalOfId: null,
      reversalReason: null,
      targetAccountId: accountMovement.transaction.targetAccount.id,
      targetAccountName: accountMovement.transaction.targetAccount.name,
    };
    const persisted = await insertCollectionRecordIdempotently(
      connection,
      collection,
    );
    if (!collectionMatches(persisted, input)) {
      throw new FinanceIdempotencyConflictError();
    }
    if (persisted.id !== collection.id) {
      const replayedReceivable = await findReceivableForUpdate(
        connection,
        persisted.receivableId,
      );
      if (!replayedReceivable) throw new FinanceResourceNotFoundError();
      return {
        collection: persisted,
        created: false,
        receivable: receivableView(replayedReceivable, today),
      };
    }
    const after: ReceivableRecord = { ...before, collectedAmount };
    await appendAuditEvent(connection, {
      action: "receivable.collection_created",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: {
        amount: persisted.amount,
        collectedAmount,
        collectedOn: persisted.collectedOn,
        outstandingAmount: remainingAmount(before.totalAmount, collectedAmount),
        receivableId: before.id,
      },
      beforeSummary: {
        collectedAmount: before.collectedAmount,
        outstandingAmount: remainingAmount(
          before.totalAmount,
          before.collectedAmount,
        ),
        receivableId: before.id,
      },
      correlationId: context.correlationId,
      entityId: persisted.id,
      entityType: "receivable_collection",
      occurredAtUtc: now,
    });
    return {
      collection: persisted,
      created: true,
      receivable: receivableView(after, today),
    };
  });
}

export async function voidReceivable(
  pool: Pool,
  id: string,
  rawInput: ReceivableLifecycleInput,
  context: FinanceWriteContext,
): Promise<ReceivableView> {
  assertCanonicalUuid(id);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = receivableLifecycleInputSchema.parse(rawInput);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);

  return withUtcTransaction(pool, async (connection) => {
    const before = await findReceivableForUpdate(connection, id);
    if (!before) throw new FinanceResourceNotFoundError();
    if (before.recordState === "voided") throw new ReceivableAlreadyVoidedError();
    if (before.version !== input.version) throw new FinanceVersionConflictError();
    if (!new Decimal(before.collectedAmount).isZero()) {
      throw new ReceivableHasCollectionsError();
    }

    const after: ReceivableRecord = {
      ...before,
      recordState: "voided",
      updatedAtUtc: now,
      version: before.version + 1,
      voidedAtUtc: now,
      voidReason: input.reason,
    };
    if (!(await updateReceivableLifecycleRecord(connection, after, before.version))) {
      throw new FinanceVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: "receivable.voided",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: { ...receivableAuditSummary(after), reason: input.reason },
      beforeSummary: receivableAuditSummary(before),
      correlationId: context.correlationId,
      entityId: id,
      entityType: "receivable",
      occurredAtUtc: now,
    });
    return receivableView(after, today);
  });
}

export async function reverseReceivableCollection(
  pool: Pool,
  collectionId: string,
  rawInput: ReverseCollectionInput,
  context: FinanceWriteContext,
): Promise<Readonly<{
  created: boolean;
  receivable: ReceivableView;
  reversal: ReceivableCollection;
}>> {
  assertCanonicalUuid(collectionId);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = reverseCollectionInputSchema.parse(rawInput);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);

  return withUtcTransaction(pool, async (connection) => {
    const replay = await findCollectionByClientOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay) {
      if (!reversalMatches(replay, collectionId, input)) {
        throw new FinanceIdempotencyConflictError();
      }
      const receivable = await findReceivableForUpdate(
        connection,
        replay.receivableId,
      );
      if (!receivable) throw new FinanceResourceNotFoundError();
      return {
        created: false,
        receivable: receivableView(receivable, today),
        reversal: replay,
      };
    }

    const original = await findCollectionForUpdate(connection, collectionId);
    if (!original) throw new FinanceResourceNotFoundError();
    if (original.entryType !== "collection") throw new CollectionNotReversibleError();
    const receivable = await findReceivableForUpdate(
      connection,
      original.receivableId,
    );
    if (!receivable) throw new FinanceResourceNotFoundError();
    if (receivable.recordState !== "active") throw new ReceivableAlreadyVoidedError();
    if (await findCollectionReversalForUpdate(connection, original.id)) {
      throw new CollectionAlreadyReversedError();
    }

    const afterCollected = new Decimal(receivable.collectedAmount).minus(
      original.amount,
    );
    if (afterCollected.isNegative()) {
      throw new Error("Collection reversal would make the aggregate negative.");
    }
    let reversalFinanceTransactionId: string | null = null;
    let targetAccountId: string | null = null;
    let targetAccountName: string | null = null;
    if (original.financeTransactionId !== null) {
      if (context.canMutateAccountLedger !== true) {
        throw new CollectionAccountPermissionError();
      }
      const accountMovement = await reverseFinanceTransactionInConnection(
        connection,
        original.financeTransactionId,
        {
          clientOperationKey: input.clientOperationKey,
          reason: input.reason,
        },
        context,
        { allowExpenseManaged: true },
      );
      if (accountMovement.transaction.sourceAccount === null) {
        throw new Error("Collection reversal has no source account.");
      }
      reversalFinanceTransactionId = accountMovement.transaction.id;
      targetAccountId = accountMovement.transaction.sourceAccount.id;
      targetAccountName = accountMovement.transaction.sourceAccount.name;
    }
    const pending: ReceivableCollection = {
      amount: original.amount,
      clientOperationKey: input.clientOperationKey,
      collectedOn: today,
      createdAtUtc: now,
      entryType: "reversal",
      financeTransactionId: reversalFinanceTransactionId,
      id: randomUUID(),
      note: null,
      receivableId: original.receivableId,
      reversalOfId: original.id,
      reversalReason: input.reason,
      targetAccountId,
      targetAccountName,
    };
    const reversal = await insertCollectionRecordIdempotently(
      connection,
      pending,
    );
    if (!reversalMatches(reversal, collectionId, input)) {
      throw new FinanceIdempotencyConflictError();
    }
    if (reversal.id !== pending.id) {
      const current = await findReceivableForUpdate(
        connection,
        reversal.receivableId,
      );
      if (!current) throw new FinanceResourceNotFoundError();
      return {
        created: false,
        receivable: receivableView(current, today),
        reversal,
      };
    }

    const after: ReceivableRecord = {
      ...receivable,
      collectedAmount: afterCollected.toFixed(4),
    };
    await appendAuditEvent(connection, {
      action: "receivable.collection_reversed",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: {
        collectedAmount: after.collectedAmount,
        originalCollectionId: original.id,
        outstandingAmount: remainingAmount(
          after.totalAmount,
          after.collectedAmount,
        ),
        reason: input.reason,
        receivableId: after.id,
      },
      beforeSummary: {
        collectedAmount: receivable.collectedAmount,
        outstandingAmount: remainingAmount(
          receivable.totalAmount,
          receivable.collectedAmount,
        ),
        receivableId: receivable.id,
      },
      correlationId: context.correlationId,
      entityId: reversal.id,
      entityType: "receivable_collection",
      occurredAtUtc: now,
    });
    return {
      created: true,
      receivable: receivableView(after, today),
      reversal,
    };
  });
}
