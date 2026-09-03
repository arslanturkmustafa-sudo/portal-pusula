import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool } from "mysql2/promise";

import { findProjectForUpdate } from "@/features/projects/repository";
import { buildCardInstallmentPlan } from "@/features/finance/card-plan";
import { addMoney } from "@/features/finance/money";
import { istanbulDate, monthBounds } from "@/features/finance/period";
import {
  deletePlannedExpenseInstallments,
  findCardInstallmentForUpdate,
  findCreditCardForUpdate,
  findExpenseByOperationKeyForUpdate,
  findExpenseForUpdate,
  insertCardInstallmentRecords,
  insertCreditCardRecordIdempotently,
  insertExpenseRecordIdempotently,
  listCardInstallmentRecords,
  listCreditCardRecords,
  listExpenseInstallmentsForUpdate,
  listExpenseRecords,
  type CardInstallment,
  type CreditCard,
  type Expense,
  updateCardInstallmentRecord,
  updateCreditCardRecord,
  updateExpenseRecord,
} from "@/features/finance/spending-repository";
import {
  type CreateCreditCardInput,
  createCreditCardInputSchema,
  type CreateExpenseInput,
  createExpenseInputSchema,
  type ExpenseListFilter,
  expenseListFilterSchema,
  type InstallmentListFilter,
  installmentListFilterSchema,
  type UpdateCardInstallmentInput,
  type UpdateCreditCardInput,
  type UpdateExpenseInput,
  updateCardInstallmentInputSchema,
  updateCreditCardInputSchema,
  updateExpenseInputSchema,
} from "@/features/finance/spending-validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class SpendingResourceNotFoundError extends Error {
  constructor() {
    super("The requested spending resource was not found.");
    this.name = "SpendingResourceNotFoundError";
  }
}

export class SpendingVersionConflictError extends Error {
  constructor() {
    super("The spending resource was changed by another request.");
    this.name = "SpendingVersionConflictError";
  }
}

export class SpendingIdempotencyConflictError extends Error {
  constructor() {
    super("The client operation key is already bound to another request.");
    this.name = "SpendingIdempotencyConflictError";
  }
}

export class CreditCardInactiveError extends Error {
  constructor() {
    super("The selected credit card is inactive.");
    this.name = "CreditCardInactiveError";
  }
}

export class ExpensePlanLockedError extends Error {
  constructor() {
    super("A paid installment prevents changing or voiding the expense plan.");
    this.name = "ExpensePlanLockedError";
  }
}

export class ExpenseAlreadyVoidedError extends Error {
  constructor() {
    super("A voided expense cannot be changed.");
    this.name = "ExpenseAlreadyVoidedError";
  }
}

export class InstallmentPaymentDateInFutureError extends Error {
  constructor() {
    super("The installment payment date cannot be in the future.");
    this.name = "InstallmentPaymentDateInFutureError";
  }
}

export type SpendingWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

export type ExpenseSummary = Readonly<{
  activeExpenseCount: number;
  creditCardAmount: string;
  totalAmount: string;
  vatAmount: string;
}>;

export type ExpenseCollection = Readonly<{
  expenses: readonly Expense[];
  summary: ExpenseSummary;
}>;

export type CardInstallmentView = Omit<CardInstallment, "status"> &
  Readonly<{ status: "overdue" | "paid" | "planned" }>;

export type CardInstallmentSummary = Readonly<{
  openAmount: string;
  overdueAmount: string;
  paidAmount: string;
  plannedAmount: string;
}>;

export type CardInstallmentCollection = Readonly<{
  installments: readonly CardInstallmentView[];
  summary: CardInstallmentSummary;
}>;

function moneyTotal(netAmount: string, vatAmount: string): string {
  return new Decimal(netAmount).plus(vatAmount).toFixed(4);
}

function cardMatches(card: CreditCard, input: CreateCreditCardInput): boolean {
  return (
    card.bankName === input.bankName &&
    card.clientOperationKey === input.clientOperationKey &&
    card.creditLimitAmount === input.creditLimitAmount &&
    card.displayName === input.displayName &&
    card.lastFour === input.lastFour &&
    card.note === input.note &&
    card.paymentDueDay === input.paymentDueDay &&
    card.statementClosingDay === input.statementClosingDay &&
    card.status === input.status
  );
}

function expenseMatches(expense: Expense, input: CreateExpenseInput): boolean {
  return (
    expense.category === input.category &&
    expense.clientOperationKey === input.clientOperationKey &&
    expense.creditCardId === input.creditCardId &&
    expense.description === input.description &&
    expense.documentNumber === input.documentNumber &&
    expense.documentType === input.documentType &&
    expense.incurredOn === input.incurredOn &&
    expense.installmentCount === input.installmentCount &&
    expense.netAmount === input.netAmount &&
    expense.note === input.note &&
    expense.paymentMethod === input.paymentMethod &&
    expense.projectId === input.projectId &&
    expense.status === "active" &&
    expense.totalAmount === moneyTotal(input.netAmount, input.vatAmount) &&
    expense.vatAmount === input.vatAmount &&
    expense.vendorName === input.vendorName
  );
}

function expensePlanChanged(before: Expense, input: UpdateExpenseInput): boolean {
  return (
    before.creditCardId !== input.creditCardId ||
    before.incurredOn !== input.incurredOn ||
    before.installmentCount !== input.installmentCount ||
    before.netAmount !== input.netAmount ||
    before.paymentMethod !== input.paymentMethod ||
    before.vatAmount !== input.vatAmount
  );
}

function cardAuditSummary(card: CreditCard) {
  return {
    bankName: card.bankName,
    creditLimitAmount: card.creditLimitAmount,
    displayName: card.displayName,
    lastFour: card.lastFour,
    paymentDueDay: card.paymentDueDay,
    statementClosingDay: card.statementClosingDay,
    status: card.status,
    version: card.version,
  };
}

function expenseAuditSummary(expense: Expense) {
  return {
    category: expense.category,
    creditCardId: expense.creditCardId,
    incurredOn: expense.incurredOn,
    installmentCount: expense.installmentCount,
    netAmount: expense.netAmount,
    paymentMethod: expense.paymentMethod,
    projectId: expense.projectId,
    status: expense.status,
    totalAmount: expense.totalAmount,
    vatAmount: expense.vatAmount,
    version: expense.version,
    voidReason: expense.voidReason,
  };
}

function installmentAuditSummary(installment: CardInstallment) {
  return {
    amount: installment.amount,
    dueOn: installment.dueOn,
    expenseId: installment.expenseId,
    paidOn: installment.paidOn,
    status: installment.status,
    version: installment.version,
  };
}

async function requireProject(
  connection: Parameters<typeof findProjectForUpdate>[0],
  projectId: string | null,
): Promise<void> {
  if (projectId === null) return;
  if (!(await findProjectForUpdate(connection, projectId))) {
    throw new SpendingResourceNotFoundError();
  }
}

async function selectedCard(
  connection: Parameters<typeof findCreditCardForUpdate>[0],
  cardId: string | null,
): Promise<CreditCard | null> {
  if (cardId === null) return null;
  const card = await findCreditCardForUpdate(connection, cardId);
  if (!card) throw new SpendingResourceNotFoundError();
  if (card.status !== "active") throw new CreditCardInactiveError();
  return card;
}

function generatedInstallments(
  expense: Expense,
  card: CreditCard,
  now: string,
) {
  return buildCardInstallmentPlan({
    incurredOn: expense.incurredOn,
    installmentCount: expense.installmentCount,
    paymentDueDay: card.paymentDueDay,
    statementClosingDay: card.statementClosingDay,
    totalAmount: expense.totalAmount,
  }).map((planned) => ({
    ...planned,
    createdAtUtc: now,
    expenseId: expense.id,
    id: randomUUID(),
    paidOn: null,
    status: "planned" as const,
    updatedAtUtc: now,
    version: 1,
  }));
}

export async function listCreditCards(pool: Pool): Promise<readonly CreditCard[]> {
  return withUtcTransaction(pool, listCreditCardRecords);
}

export async function createCreditCard(
  pool: Pool,
  rawInput: CreateCreditCardInput,
  context: SpendingWriteContext,
): Promise<Readonly<{ card: CreditCard; created: boolean }>> {
  const input = createCreditCardInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  const pending: CreditCard = {
    ...input,
    createdAtUtc: now,
    id: randomUUID(),
    updatedAtUtc: now,
    version: 1,
  };
  return withUtcTransaction(pool, async (connection) => {
    const persisted = await insertCreditCardRecordIdempotently(connection, pending);
    if (!cardMatches(persisted, input)) {
      throw new SpendingIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      await appendAuditEvent(connection, {
        action: "credit_card.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: cardAuditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "credit_card",
        occurredAtUtc: now,
      });
    }
    return { card: persisted, created };
  });
}

export async function updateCreditCard(
  pool: Pool,
  id: string,
  rawInput: UpdateCreditCardInput,
  context: SpendingWriteContext,
): Promise<CreditCard> {
  assertCanonicalUuid(id);
  const input = updateCreditCardInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const before = await findCreditCardForUpdate(connection, id);
    if (!before) throw new SpendingResourceNotFoundError();
    if (before.version !== input.version) throw new SpendingVersionConflictError();
    const { version: expectedVersion, ...changes } = input;
    const after: CreditCard = {
      ...before,
      ...changes,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateCreditCardRecord(connection, after, expectedVersion))) {
      throw new SpendingVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: "credit_card.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: cardAuditSummary(after),
      beforeSummary: cardAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "credit_card",
      occurredAtUtc: now,
    });
    return after;
  });
}

export async function listExpenses(
  pool: Pool,
  rawFilters: ExpenseListFilter,
): Promise<ExpenseCollection> {
  const filters = expenseListFilterSchema.parse(rawFilters);
  const bounds = filters.month ? monthBounds(filters.month) : null;
  const range =
    bounds === null
      ? null
      : { nextStartOn: bounds.nextMonthStart, startOn: bounds.monthStart };
  return withUtcTransaction(pool, async (connection) => {
    const expenses = await listExpenseRecords(connection, filters, range);
    let totalAmount = "0.0000";
    let vatAmount = "0.0000";
    let creditCardAmount = "0.0000";
    let activeExpenseCount = 0;
    for (const expense of expenses) {
      if (expense.status !== "active") continue;
      activeExpenseCount += 1;
      totalAmount = addMoney(totalAmount, expense.totalAmount);
      vatAmount = addMoney(vatAmount, expense.vatAmount);
      if (expense.paymentMethod === "credit_card") {
        creditCardAmount = addMoney(creditCardAmount, expense.totalAmount);
      }
    }
    return {
      expenses,
      summary: { activeExpenseCount, creditCardAmount, totalAmount, vatAmount },
    };
  });
}

export async function createExpense(
  pool: Pool,
  rawInput: CreateExpenseInput,
  context: SpendingWriteContext,
): Promise<Readonly<{ created: boolean; expense: Expense }>> {
  const input = createExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const replay = await findExpenseByOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay) {
      if (!expenseMatches(replay, input)) {
        throw new SpendingIdempotencyConflictError();
      }
      return { created: false, expense: replay };
    }
    await requireProject(connection, input.projectId);
    const card = await selectedCard(connection, input.creditCardId);
    const pending: Expense = {
      ...input,
      createdAtUtc: now,
      creditCardName: card?.displayName ?? null,
      currency: "TRY",
      id: randomUUID(),
      projectName: null,
      projectShortCode: null,
      status: "active",
      totalAmount: moneyTotal(input.netAmount, input.vatAmount),
      updatedAtUtc: now,
      version: 1,
      voidedAtUtc: null,
      voidReason: null,
    };
    const persisted = await insertExpenseRecordIdempotently(connection, pending);
    if (!expenseMatches(persisted, input)) {
      throw new SpendingIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      if (card !== null) {
        await insertCardInstallmentRecords(
          connection,
          generatedInstallments(persisted, card, now),
        );
      }
      await appendAuditEvent(connection, {
        action: "expense.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: expenseAuditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "expense",
        occurredAtUtc: now,
      });
    }
    return { created, expense: persisted };
  });
}

export async function updateExpense(
  pool: Pool,
  id: string,
  rawInput: UpdateExpenseInput,
  context: SpendingWriteContext,
): Promise<Expense> {
  assertCanonicalUuid(id);
  const input = updateExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const before = await findExpenseForUpdate(connection, id);
    if (!before) throw new SpendingResourceNotFoundError();
    if (before.version !== input.version) throw new SpendingVersionConflictError();
    if (before.status === "voided") throw new ExpenseAlreadyVoidedError();

    await requireProject(connection, input.projectId);
    const planChanged = expensePlanChanged(before, input);
    const card =
      input.creditCardId === null
        ? null
        : await findCreditCardForUpdate(connection, input.creditCardId);
    if (input.creditCardId !== null && card === null) {
      throw new SpendingResourceNotFoundError();
    }
    if (
      card !== null &&
      card.status !== "active" &&
      planChanged &&
      input.status === "active"
    ) {
      throw new CreditCardInactiveError();
    }
    const installments = await listExpenseInstallmentsForUpdate(connection, id);
    const hasPaidInstallment = installments.some((item) => item.status === "paid");
    if (hasPaidInstallment && (planChanged || input.status === "voided")) {
      throw new ExpensePlanLockedError();
    }

    const { version: expectedVersion, ...changes } = input;
    const afterCandidate: Expense = {
      ...before,
      ...changes,
      totalAmount: moneyTotal(input.netAmount, input.vatAmount),
      updatedAtUtc: now,
      version: before.version + 1,
      voidedAtUtc: input.status === "voided" ? now : null,
    };
    if (planChanged) {
      await deletePlannedExpenseInstallments(connection, id);
    }
    if (!(await updateExpenseRecord(connection, afterCandidate, expectedVersion))) {
      throw new SpendingVersionConflictError();
    }
    if (planChanged && card !== null && input.status === "active") {
      await insertCardInstallmentRecords(
        connection,
        generatedInstallments(afterCandidate, card, now),
      );
    }
    const after = await findExpenseForUpdate(connection, id);
    if (!after) throw new SpendingResourceNotFoundError();
    await appendAuditEvent(connection, {
      action: input.status === "voided" ? "expense.voided" : "expense.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: expenseAuditSummary(after),
      beforeSummary: expenseAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "expense",
      occurredAtUtc: now,
    });
    return after;
  });
}

export async function listCardInstallments(
  pool: Pool,
  rawFilters: InstallmentListFilter,
  now = new Date(),
): Promise<CardInstallmentCollection> {
  const filters = installmentListFilterSchema.parse(rawFilters);
  const today = istanbulDate(now);
  return withUtcTransaction(pool, async (connection) => {
    const stored = await listCardInstallmentRecords(connection, filters);
    let openAmount = "0.0000";
    let overdueAmount = "0.0000";
    let paidAmount = "0.0000";
    let plannedAmount = "0.0000";
    const installments = stored.map<CardInstallmentView>((item) => {
      const status =
        item.status === "paid"
          ? "paid"
          : item.dueOn < today
            ? "overdue"
            : "planned";
      if (status === "paid") paidAmount = addMoney(paidAmount, item.amount);
      else {
        openAmount = addMoney(openAmount, item.amount);
        if (status === "overdue") {
          overdueAmount = addMoney(overdueAmount, item.amount);
        } else {
          plannedAmount = addMoney(plannedAmount, item.amount);
        }
      }
      return { ...item, status };
    });
    return {
      installments,
      summary: { openAmount, overdueAmount, paidAmount, plannedAmount },
    };
  });
}

export async function updateCardInstallment(
  pool: Pool,
  id: string,
  rawInput: UpdateCardInstallmentInput,
  context: SpendingWriteContext,
): Promise<CardInstallmentView> {
  assertCanonicalUuid(id);
  const input = updateCardInstallmentInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);
  if (input.paidOn !== null && input.paidOn > today) {
    throw new InstallmentPaymentDateInFutureError();
  }
  return withUtcTransaction(pool, async (connection) => {
    const locked = await findCardInstallmentForUpdate(connection, id);
    if (!locked) {
      throw new SpendingResourceNotFoundError();
    }
    const { expenseStatus, ...before } = locked;
    if (expenseStatus !== "active") throw new SpendingResourceNotFoundError();
    if (before.version !== input.version) throw new SpendingVersionConflictError();
    const after: CardInstallment = {
      ...before,
      paidOn: input.paidOn,
      status: input.status,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateCardInstallmentRecord(connection, after, input.version))) {
      throw new SpendingVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action:
        input.status === "paid"
          ? "credit_card_installment.paid"
          : "credit_card_installment.reopened",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: installmentAuditSummary(after),
      beforeSummary: installmentAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "credit_card_installment",
      occurredAtUtc: now,
    });
    const visibleStatus =
      after.status === "paid"
        ? "paid"
        : after.dueOn < today
          ? "overdue"
          : "planned";
    return { ...after, status: visibleStatus };
  });
}
