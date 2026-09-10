import "server-only";

import { createHash, randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
} from "@/features/finance/account-service";
import { findFinanceAccountForUpdate } from "@/features/finance/account-repository";
import { findActiveExpenseCategoryByCodeForUpdate } from "@/features/finance/expense-category-repository";
import {
  findRecurringExpensePlanByOperationKeyForUpdate,
  findRecurringExpensePlanForUpdate,
  insertRecurringExpensePlanIdempotently,
  listRecurringExpensePlanRecords,
  type RecurringExpensePlan,
  updateRecurringExpensePlanRecord,
} from "@/features/finance/recurring-expense-repository";
import {
  type CreateRecurringExpenseInput,
  createRecurringExpenseInputSchema,
  type RealizeRecurringExpenseInput,
  realizeRecurringExpenseInputSchema,
  type UpdateRecurringExpenseInput,
  updateRecurringExpenseInputSchema,
} from "@/features/finance/recurring-expense-validation";
import {
  createExpenseInConnection,
  CreditCardInactiveError,
  ExpenseSourceAccountTypeError,
  type SpendingWriteContext,
  SpendingResourceNotFoundError,
} from "@/features/finance/spending-service";
import { findCreditCardForUpdate } from "@/features/finance/spending-repository";
import { findProjectForUpdate } from "@/features/projects/repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import {
  nextOccurrenceOn,
  recurrenceAnchorDay,
} from "@/platform/recurrence/schedule";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";
import { istanbulDate } from "@/features/finance/period";

export class RecurringExpensePlanNotFoundError extends Error {
  constructor() {
    super("The recurring expense plan was not found.");
    this.name = "RecurringExpensePlanNotFoundError";
  }
}

export class RecurringExpenseVersionConflictError extends Error {
  constructor() {
    super("The recurring expense plan was changed by another request.");
    this.name = "RecurringExpenseVersionConflictError";
  }
}

export class RecurringExpenseIdempotencyConflictError extends Error {
  constructor() {
    super("The operation key is already bound to another recurring expense plan.");
    this.name = "RecurringExpenseIdempotencyConflictError";
  }
}

export class RecurringExpensePlanPausedError extends Error {
  constructor() {
    super("The recurring expense plan is paused.");
    this.name = "RecurringExpensePlanPausedError";
  }
}

export class RecurringExpenseNotDueError extends Error {
  constructor() {
    super("The recurring expense plan is not due yet.");
    this.name = "RecurringExpenseNotDueError";
  }
}

function totalAmount(netAmount: string, vatAmount: string): string {
  return new Decimal(netAmount).plus(vatAmount).toFixed(4);
}

function realizationOperationKey(plan: RecurringExpensePlan): string {
  const digest = createHash("sha256")
    .update(
      `portal-pusula:recurring-expense:${plan.id}:${plan.version}:${plan.nextDueOn}`,
    )
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function planAuditSummary(plan: RecurringExpensePlan) {
  return {
    category: plan.category,
    creditCardId: plan.creditCardId,
    endsOn: plan.endsOn,
    frequency: plan.frequency,
    netAmount: plan.netAmount,
    nextDueOn: plan.nextDueOn,
    paymentMethod: plan.paymentMethod,
    projectId: plan.projectId,
    sourceAccountId: plan.sourceAccountId,
    status: plan.status,
    totalAmount: plan.totalAmount,
    vatAmount: plan.vatAmount,
    version: plan.version,
  };
}

function planMatches(
  plan: RecurringExpensePlan,
  input: CreateRecurringExpenseInput,
): boolean {
  return (
    plan.anchorDay === recurrenceAnchorDay(input.firstDueOn) &&
    plan.category === input.category &&
    plan.clientOperationKey === input.clientOperationKey &&
    plan.creditCardId === input.creditCardId &&
    plan.description === input.description &&
    plan.endsOn === input.endsOn &&
    plan.frequency === input.frequency &&
    plan.netAmount === input.netAmount &&
    plan.nextDueOn === input.firstDueOn &&
    plan.note === input.note &&
    plan.paymentMethod === input.paymentMethod &&
    plan.projectId === input.projectId &&
    plan.sourceAccountId === input.sourceAccountId &&
    plan.status === "active" &&
    plan.totalAmount === totalAmount(input.netAmount, input.vatAmount) &&
    plan.vatAmount === input.vatAmount &&
    plan.vendorName === input.vendorName
  );
}

async function validateReferences(
  connection: PoolConnection,
  input: Readonly<{
    category: string;
    creditCardId: string | null;
    paymentMethod: RecurringExpensePlan["paymentMethod"];
    projectId: string | null;
    sourceAccountId: string | null;
  }>,
  requireActive: boolean,
): Promise<void> {
  if (!(await findActiveExpenseCategoryByCodeForUpdate(connection, input.category))) {
    throw new SpendingResourceNotFoundError();
  }
  if (
    input.projectId !== null &&
    !(await findProjectForUpdate(connection, input.projectId))
  ) {
    throw new SpendingResourceNotFoundError();
  }
  if (input.creditCardId !== null) {
    const card = await findCreditCardForUpdate(connection, input.creditCardId);
    if (!card) throw new SpendingResourceNotFoundError();
    if (requireActive && card.status !== "active") {
      throw new CreditCardInactiveError();
    }
  }
  if (input.sourceAccountId !== null) {
    const account = await findFinanceAccountForUpdate(
      connection,
      input.sourceAccountId,
    );
    if (!account) throw new FinanceAccountNotFoundError();
    if (requireActive && account.status !== "active") {
      throw new FinanceAccountInactiveError();
    }
    const expectedType = input.paymentMethod === "cash" ? "cash" : "bank";
    if (account.accountType !== expectedType) {
      throw new ExpenseSourceAccountTypeError();
    }
  }
}

export async function listRecurringExpensePlans(
  pool: Pool,
): Promise<readonly RecurringExpensePlan[]> {
  return withUtcTransaction(pool, listRecurringExpensePlanRecords);
}

export async function createRecurringExpensePlan(
  pool: Pool,
  rawInput: CreateRecurringExpenseInput,
  context: SpendingWriteContext,
): Promise<Readonly<{ created: boolean; plan: RecurringExpensePlan }>> {
  const input = createRecurringExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const replay = await findRecurringExpensePlanByOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay) {
      if (!planMatches(replay, input)) {
        throw new RecurringExpenseIdempotencyConflictError();
      }
      return { created: false, plan: replay };
    }
    await validateReferences(connection, input, true);
    const pending: RecurringExpensePlan = {
      anchorDay: recurrenceAnchorDay(input.firstDueOn),
      category: input.category,
      clientOperationKey: input.clientOperationKey,
      createdAtUtc: now,
      creditCardId: input.creditCardId,
      creditCardName: null,
      currency: "TRY",
      description: input.description,
      endsOn: input.endsOn,
      frequency: input.frequency,
      id: randomUUID(),
      netAmount: input.netAmount,
      nextDueOn: input.firstDueOn,
      note: input.note,
      paymentMethod: input.paymentMethod,
      projectId: input.projectId,
      projectName: null,
      projectShortCode: null,
      sourceAccountId: input.sourceAccountId,
      sourceAccountName: null,
      sourceAccountType: null,
      status: "active",
      totalAmount: totalAmount(input.netAmount, input.vatAmount),
      updatedAtUtc: now,
      vatAmount: input.vatAmount,
      vendorName: input.vendorName,
      version: 1,
    };
    const persisted = await insertRecurringExpensePlanIdempotently(
      connection,
      pending,
    );
    if (!planMatches(persisted, input)) {
      throw new RecurringExpenseIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      await appendAuditEvent(connection, {
        action: "recurring_expense.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: planAuditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "recurring_expense",
        occurredAtUtc: now,
      });
    }
    return { created, plan: persisted };
  });
}

export async function updateRecurringExpensePlan(
  pool: Pool,
  id: string,
  rawInput: UpdateRecurringExpenseInput,
  context: SpendingWriteContext,
): Promise<RecurringExpensePlan> {
  assertCanonicalUuid(id);
  const input = updateRecurringExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findRecurringExpensePlanForUpdate(connection, id);
    if (!before) throw new RecurringExpensePlanNotFoundError();
    if (before.version !== input.version) {
      throw new RecurringExpenseVersionConflictError();
    }
    await validateReferences(connection, input, input.status === "active");
    const scheduleChanged =
      before.frequency !== input.frequency || before.nextDueOn !== input.nextDueOn;
    const { version: expectedVersion, ...changes } = input;
    const after: RecurringExpensePlan = {
      ...before,
      ...changes,
      anchorDay: scheduleChanged
        ? recurrenceAnchorDay(input.nextDueOn)
        : before.anchorDay,
      totalAmount: totalAmount(input.netAmount, input.vatAmount),
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateRecurringExpensePlanRecord(connection, after, expectedVersion))) {
      throw new RecurringExpenseVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action:
        after.status === "paused" && before.status !== "paused"
          ? "recurring_expense.paused"
          : after.status === "active" && before.status !== "active"
            ? "recurring_expense.activated"
            : "recurring_expense.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: planAuditSummary(after),
      beforeSummary: planAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "recurring_expense",
      occurredAtUtc: now,
    });
    const stored = await findRecurringExpensePlanForUpdate(connection, id);
    if (!stored) throw new RecurringExpensePlanNotFoundError();
    return stored;
  });
}

export async function realizeRecurringExpensePlan(
  pool: Pool,
  id: string,
  rawInput: RealizeRecurringExpenseInput,
  context: SpendingWriteContext,
): Promise<
  Readonly<{
    created: true;
    expense: Awaited<ReturnType<typeof createExpenseInConnection>>["expense"];
    plan: RecurringExpensePlan;
  }>
> {
  assertCanonicalUuid(id);
  const input = realizeRecurringExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);

  return withUtcTransaction(pool, async (connection) => {
    const before = await findRecurringExpensePlanForUpdate(connection, id);
    if (!before) throw new RecurringExpensePlanNotFoundError();
    if (before.version !== input.version) {
      throw new RecurringExpenseVersionConflictError();
    }
    if (before.status !== "active") throw new RecurringExpensePlanPausedError();
    if (before.nextDueOn > today) throw new RecurringExpenseNotDueError();

    const createdExpense = await createExpenseInConnection(
      connection,
      {
        category: before.category,
        clientOperationKey: realizationOperationKey(before),
        creditCardId: before.creditCardId,
        description: before.description,
        documentNumber: null,
        documentType: "none",
        incurredOn: before.nextDueOn,
        installmentCount: 1,
        netAmount: before.netAmount,
        note: before.note,
        paymentMethod: before.paymentMethod,
        projectId: before.projectId,
        sourceAccountId: before.sourceAccountId,
        vatAmount: before.vatAmount,
        vendorName: before.vendorName,
      },
      { ...context, now: nowDate },
    );
    if (!createdExpense.created) {
      throw new RecurringExpenseIdempotencyConflictError();
    }

    const nextDueOn = nextOccurrenceOn(
      before.nextDueOn,
      before.frequency,
      before.anchorDay,
    );
    const after: RecurringExpensePlan = {
      ...before,
      nextDueOn,
      status:
        before.endsOn !== null && nextDueOn > before.endsOn
          ? "paused"
          : "active",
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateRecurringExpensePlanRecord(connection, after, before.version))) {
      throw new RecurringExpenseVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: "recurring_expense.realized",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: {
        ...planAuditSummary(after),
        expenseId: createdExpense.expense.id,
        realizedDueOn: before.nextDueOn,
      },
      beforeSummary: planAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "recurring_expense",
      occurredAtUtc: now,
    });
    return { created: true, expense: createdExpense.expense, plan: after };
  });
}
