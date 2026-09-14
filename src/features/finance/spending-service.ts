import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool, PoolConnection } from "mysql2/promise";

import { listActiveOwnerEmailRecipients } from "@/features/account/repository";
import { findProjectForUpdate } from "@/features/projects/repository";
import { buildCardInstallmentPlan } from "@/features/finance/card-plan";
import {
  createFinanceTransactionInConnection,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  reverseFinanceTransactionInConnection,
} from "@/features/finance/account-service";
import {
  findFinanceAccountForUpdate,
  type FinanceAccountRecord,
} from "@/features/finance/account-repository";
import { findActiveExpenseCategoryByCodeForUpdate } from "@/features/finance/expense-category-repository";
import { addMoney } from "@/features/finance/money";
import { istanbulDate, monthBounds } from "@/features/finance/period";
import {
  deletePlannedExpenseInstallments,
  findCardInstallmentPaymentByOperationKeyForUpdate,
  findCardInstallmentForUpdate,
  findCreditCardForUpdate,
  findExpenseByOperationKeyForUpdate,
  findExpenseForUpdate,
  insertCardInstallmentPaymentRecordIdempotently,
  insertCardInstallmentRecords,
  insertCreditCardRecordIdempotently,
  insertExpenseRecordIdempotently,
  listCardInstallmentRecords,
  listCardInstallmentsForBulkUpdate,
  listCardInstallmentPaymentsForUpdate,
  listCreditCardRecords,
  listExpenseInstallmentsForUpdate,
  listExpenseRecords,
  type CardInstallment,
  type CardInstallmentPayment,
  type CreditCard,
  type Expense,
  updateCardInstallmentRecord,
  updateCreditCardRecord,
  updateExpenseRecord,
} from "@/features/finance/spending-repository";
import {
  type BulkPayCardInstallmentsInput,
  bulkPayCardInstallmentsInputSchema,
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
  type VoidExpenseInput,
  updateCardInstallmentInputSchema,
  updateCreditCardInputSchema,
  updateExpenseInputSchema,
  voidExpenseInputSchema,
} from "@/features/finance/spending-validation";
import { buildExpenseCreatedEmail } from "@/features/notifications/email-templates";
import { appendAuditEvent } from "@/platform/audit/repository";
import { enqueueEmailDelivery } from "@/platform/email/outbox-email";
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

export class ExpenseSourceAccountTypeError extends Error {
  constructor() {
    super("The selected account type does not match the expense payment method.");
    this.name = "ExpenseSourceAccountTypeError";
  }
}

export class ExpenseAccountPermissionError extends Error {
  constructor() {
    super("Finance account permissions are required for this expense movement.");
    this.name = "ExpenseAccountPermissionError";
  }
}

export class InstallmentPaymentDateInFutureError extends Error {
  constructor() {
    super("The installment payment date cannot be in the future.");
    this.name = "InstallmentPaymentDateInFutureError";
  }
}

export class CardInstallmentBulkConflictError extends Error {
  constructor() {
    super("The card installment selection changed before bulk payment.");
    this.name = "CardInstallmentBulkConflictError";
  }
}

export class CardInstallmentPaymentExceedsRemainingError extends Error {
  constructor() {
    super("The card installment payment exceeds the remaining amount.");
    this.name = "CardInstallmentPaymentExceedsRemainingError";
  }
}

export type SpendingWriteContext = Readonly<{
  actorId?: string;
  canMutateAccountLedger?: boolean;
  correlationId: string;
  emailNotificationsEnabled?: boolean;
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

export type CardInstallmentCardSummary = Readonly<{
  cardId: string;
  creditCardName: string;
  nextDueAmount: string;
  nextDueOn: string | null;
  overdueAmount: string;
  paidAmount: string;
  remainingAmount: string;
  totalAmount: string;
}>;

export type CardInstallmentCollection = Readonly<{
  cardSummaries: readonly CardInstallmentCardSummary[];
  installments: readonly CardInstallmentView[];
  summary: CardInstallmentSummary;
}>;

export type BulkPayCardInstallmentsResult = Readonly<{
  installments: readonly CardInstallmentView[];
  replayed: boolean;
  updatedCount: number;
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
    expense.sourceAccountId === input.sourceAccountId &&
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
    before.sourceAccountId !== input.sourceAccountId ||
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
    sourceAccountId: expense.sourceAccountId,
    financeTransactionId: expense.financeTransactionId,
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
    financeTransactionId: installment.financeTransactionId,
    paidAmount: installment.paidAmount,
    paidOn: installment.paidOn,
    paymentAccountId: installment.paymentAccountId,
    remainingAmount: installment.remainingAmount,
    status: installment.status,
    version: installment.version,
  };
}

function installmentView(
  installment: CardInstallment,
  today: string,
): CardInstallmentView {
  const status =
    new Decimal(installment.remainingAmount).isZero()
      ? "paid"
      : installment.dueOn < today
        ? "overdue"
        : "planned";
  return { ...installment, status };
}

function summarizeInstallmentsByCard(
  installments: readonly CardInstallmentView[],
): readonly CardInstallmentCardSummary[] {
  const summaries = new Map<string, CardInstallmentCardSummary>();
  for (const installment of installments) {
    const current = summaries.get(installment.creditCardId) ?? {
      cardId: installment.creditCardId,
      creditCardName: installment.creditCardName,
      nextDueAmount: "0.0000",
      nextDueOn: null,
      overdueAmount: "0.0000",
      paidAmount: "0.0000",
      remainingAmount: "0.0000",
      totalAmount: "0.0000",
    };
    const isEarlierDue =
      installment.status === "planned" &&
      (current.nextDueOn === null || installment.dueOn < current.nextDueOn);
    const isSameDue =
      installment.status === "planned" &&
      installment.dueOn === current.nextDueOn;
    summaries.set(installment.creditCardId, {
      ...current,
      nextDueAmount: isEarlierDue
        ? installment.remainingAmount
        : isSameDue
          ? addMoney(current.nextDueAmount, installment.remainingAmount)
          : current.nextDueAmount,
      nextDueOn: isEarlierDue ? installment.dueOn : current.nextDueOn,
      overdueAmount:
        installment.status === "overdue"
          ? addMoney(current.overdueAmount, installment.remainingAmount)
          : current.overdueAmount,
      paidAmount: addMoney(current.paidAmount, installment.paidAmount),
      remainingAmount: addMoney(
        current.remainingAmount,
        installment.remainingAmount,
      ),
      totalAmount: addMoney(current.totalAmount, installment.amount),
    });
  }
  return [...summaries.values()].sort(
    (left, right) =>
      left.creditCardName.localeCompare(right.creditCardName, "tr") ||
      left.cardId.localeCompare(right.cardId),
  );
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

function isDirectAccountPayment(
  paymentMethod: Expense["paymentMethod"],
): paymentMethod is "bank_transfer" | "cash" {
  return paymentMethod === "bank_transfer" || paymentMethod === "cash";
}

async function selectedSourceAccount(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  sourceAccountId: string | null,
  paymentMethod: Expense["paymentMethod"],
): Promise<FinanceAccountRecord | null> {
  if (!isDirectAccountPayment(paymentMethod)) return null;
  if (sourceAccountId === null) throw new FinanceAccountNotFoundError();
  const account = await findFinanceAccountForUpdate(connection, sourceAccountId);
  if (!account) throw new FinanceAccountNotFoundError();
  if (account.status !== "active") throw new FinanceAccountInactiveError();
  const expectedType = paymentMethod === "cash" ? "cash" : "bank";
  if (account.accountType !== expectedType) {
    throw new ExpenseSourceAccountTypeError();
  }
  return account;
}

async function selectedCardPaymentAccount(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  sourceAccountId: string,
): Promise<FinanceAccountRecord> {
  const account = await findFinanceAccountForUpdate(connection, sourceAccountId);
  if (!account) throw new FinanceAccountNotFoundError();
  if (account.status !== "active") throw new FinanceAccountInactiveError();
  return account;
}

function requireAccountLedgerPermission(context: SpendingWriteContext): void {
  if (context.canMutateAccountLedger !== true) {
    throw new ExpenseAccountPermissionError();
  }
}

function ledgerDescription(description: string): string {
  return Array.from(`Gider: ${description}`).slice(0, 191).join("");
}

async function createExpenseMovement(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  input: Readonly<{
    amount: string;
    description: string;
    occurredOn: string;
    operationKey: string;
    sourceAccountId: string;
  }>,
  context: SpendingWriteContext,
): Promise<string> {
  const result = await createFinanceTransactionInConnection(
    connection,
    {
      amount: input.amount,
      clientOperationKey: input.operationKey,
      description: ledgerDescription(input.description),
      occurredOn: input.occurredOn,
      sourceAccountId: input.sourceAccountId,
      targetAccountId: null,
      transactionType: "expense",
    },
    context,
  );
  return result.transaction.id;
}

async function reverseExpenseMovement(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  transactionId: string,
  reason: string,
  context: SpendingWriteContext,
  preserveOriginalDate = false,
): Promise<void> {
  await reverseFinanceTransactionInConnection(
    connection,
    transactionId,
    { clientOperationKey: randomUUID(), reason },
    context,
    { allowExpenseManaged: true, preserveOriginalDate },
  );
}

function cardPaymentLedgerDescription(installment: CardInstallment): string {
  return Array.from(
    `Kart ödemesi: ${installment.creditCardName} · ${installment.expenseDescription} ${installment.installmentNumber}/${installment.installmentCount}`,
  )
    .slice(0, 191)
    .join("");
}

async function createCardPaymentMovement(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  installment: CardInstallment,
  amount: string,
  clientOperationKey: string,
  paidOn: string,
  sourceAccountId: string,
  context: SpendingWriteContext,
): Promise<string> {
  const result = await createFinanceTransactionInConnection(
    connection,
    {
      amount,
      clientOperationKey,
      description: cardPaymentLedgerDescription(installment),
      occurredOn: paidOn,
      sourceAccountId,
      targetAccountId: null,
      transactionType: "expense",
    },
    context,
  );
  return result.transaction.id;
}

async function reverseCardPaymentMovement(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  transactionId: string,
  clientOperationKey: string,
  reason: string,
  context: SpendingWriteContext,
): Promise<string> {
  const result = await reverseFinanceTransactionInConnection(
    connection,
    transactionId,
    { clientOperationKey, reason },
    context,
    { allowExpenseManaged: true, preserveOriginalDate: true },
  );
  return result.transaction.id;
}

function cardPaymentMatches(
  payment: CardInstallmentPayment,
  expected: Readonly<{
    amount: string;
    clientOperationKey: string;
    installmentId: string;
    paidOn: string;
    sourceAccountId: string;
  }>,
): boolean {
  return (
    payment.amount === expected.amount &&
    payment.clientOperationKey === expected.clientOperationKey &&
    payment.entryType === "payment" &&
    payment.installmentId === expected.installmentId &&
    payment.paidOn === expected.paidOn &&
    payment.paymentAccountId === expected.sourceAccountId &&
    payment.reversalOfId === null &&
    payment.reversalReason === null
  );
}

function activeCardPayments(
  payments: readonly CardInstallmentPayment[],
): readonly CardInstallmentPayment[] {
  return payments.filter(
    (payment) => payment.entryType === "payment" && !payment.reversed,
  );
}

async function createCardInstallmentPaymentEntry(
  connection: Parameters<typeof findFinanceAccountForUpdate>[0],
  installment: CardInstallment,
  input: Readonly<{
    amount: string;
    clientOperationKey: string;
    paidOn: string;
    sourceAccountId: string;
  }>,
  paymentAccount: FinanceAccountRecord,
  now: string,
  context: SpendingWriteContext,
): Promise<CardInstallmentPayment> {
  const financeTransactionId = await createCardPaymentMovement(
    connection,
    installment,
    input.amount,
    input.clientOperationKey,
    input.paidOn,
    paymentAccount.id,
    context,
  );
  const pending: CardInstallmentPayment = {
    amount: input.amount,
    clientOperationKey: input.clientOperationKey,
    createdAtUtc: now,
    entryType: "payment",
    financeTransactionId,
    id: randomUUID(),
    installmentId: installment.id,
    paidOn: input.paidOn,
    paymentAccountId: paymentAccount.id,
    paymentAccountName: paymentAccount.displayName,
    paymentAccountType: paymentAccount.accountType,
    reversalOfId: null,
    reversalReason: null,
    reversed: false,
  };
  const persisted = await insertCardInstallmentPaymentRecordIdempotently(
    connection,
    pending,
  );
  if (!cardPaymentMatches(persisted, { ...input, installmentId: installment.id })) {
    throw new SpendingIdempotencyConflictError();
  }
  return persisted;
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
    financeTransactionId: null,
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

export async function createExpenseInConnection(
  connection: PoolConnection,
  rawInput: CreateExpenseInput,
  context: SpendingWriteContext,
): Promise<Readonly<{ created: boolean; expense: Expense }>> {
  const input = createExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
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
  if (!(await findActiveExpenseCategoryByCodeForUpdate(connection, input.category))) {
    throw new SpendingResourceNotFoundError();
  }
  await requireProject(connection, input.projectId);
  const card = await selectedCard(connection, input.creditCardId);
  if (isDirectAccountPayment(input.paymentMethod)) {
    requireAccountLedgerPermission(context);
  }
  const sourceAccount = await selectedSourceAccount(
    connection,
    input.sourceAccountId,
    input.paymentMethod,
  );
  const totalAmount = moneyTotal(input.netAmount, input.vatAmount);
  const financeTransactionId =
    sourceAccount === null
      ? null
      : await createExpenseMovement(
          connection,
          {
            amount: totalAmount,
            description: input.description,
            occurredOn: input.incurredOn,
            operationKey: input.clientOperationKey,
            sourceAccountId: sourceAccount.id,
          },
          context,
        );
  const pending: Expense = {
    ...input,
    createdAtUtc: now,
    creditCardName: card?.displayName ?? null,
    currency: "TRY",
    financeTransactionId,
    id: randomUUID(),
    projectName: null,
    projectShortCode: null,
    sourceAccountName: sourceAccount?.displayName ?? null,
    sourceAccountType: sourceAccount?.accountType ?? null,
    status: "active",
    totalAmount,
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
    if (context.emailNotificationsEnabled === true) {
      const recipients = await listActiveOwnerEmailRecipients(connection);
      const message = buildExpenseCreatedEmail(persisted);
      for (const recipient of recipients) {
        await enqueueEmailDelivery(connection, {
          availableAtUtc: now,
          idempotencyKey: `expense-created:${persisted.id}:${recipient.id}`,
          message,
          recipientAccountId: recipient.id,
        });
      }
    }
  }
  return { created, expense: persisted };
}

export async function createExpense(
  pool: Pool,
  rawInput: CreateExpenseInput,
  context: SpendingWriteContext,
): Promise<Readonly<{ created: boolean; expense: Expense }>> {
  return withUtcTransaction(pool, (connection) =>
    createExpenseInConnection(connection, rawInput, context),
  );
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

    if (
      before.category !== input.category &&
      !(await findActiveExpenseCategoryByCodeForUpdate(connection, input.category))
    ) {
      throw new SpendingResourceNotFoundError();
    }
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
    const hasPaidInstallment = installments.some((item) =>
      new Decimal(item.paidAmount).greaterThan(0),
    );
    const hasPaymentHistory = installments.some((item) => item.hasPaymentHistory);
    if (
      (hasPaidInstallment && (planChanged || input.status === "voided")) ||
      (hasPaymentHistory && planChanged)
    ) {
      throw new ExpensePlanLockedError();
    }

    const totalAmount = moneyTotal(input.netAmount, input.vatAmount);
    const directPayment = isDirectAccountPayment(input.paymentMethod);
    const movementChanged =
      before.description !== input.description ||
      before.financeTransactionId === null ||
      before.incurredOn !== input.incurredOn ||
      before.paymentMethod !== input.paymentMethod ||
      before.sourceAccountId !== input.sourceAccountId ||
      before.totalAmount !== totalAmount;
    const mustReverseMovement =
      before.financeTransactionId !== null &&
      (input.status === "voided" || movementChanged || !directPayment);
    const mustCreateMovement =
      input.status === "active" && directPayment && movementChanged;
    if (directPayment || mustReverseMovement || mustCreateMovement) {
      requireAccountLedgerPermission(context);
    }
    const sourceAccount =
      mustCreateMovement
        ? await selectedSourceAccount(
            connection,
            input.sourceAccountId,
            input.paymentMethod,
          )
        : null;
    if (mustReverseMovement && before.financeTransactionId !== null) {
      const reason =
        input.status === "voided"
          ? Array.from(`Gider iptali: ${input.voidReason ?? "Gider iptal edildi."}`)
              .slice(0, 2000)
              .join("")
          : "Gider ödeme hareketi güncellendi.";
      await reverseExpenseMovement(
        connection,
        before.financeTransactionId,
        reason,
        context,
        input.status !== "voided",
      );
    }
    const financeTransactionId =
      mustCreateMovement && sourceAccount !== null
        ? await createExpenseMovement(
            connection,
            {
              amount: totalAmount,
              description: input.description,
              occurredOn: input.incurredOn,
              operationKey: randomUUID(),
              sourceAccountId: sourceAccount.id,
            },
            context,
          )
        : input.status === "active" && directPayment
          ? before.financeTransactionId
          : input.status === "voided"
            ? before.financeTransactionId
            : null;
    const { version: expectedVersion, ...changes } = input;
    const afterCandidate: Expense = {
      ...before,
      ...changes,
      financeTransactionId,
      sourceAccountId:
        input.status === "voided"
          ? before.sourceAccountId
          : directPayment
            ? sourceAccount?.id ?? before.sourceAccountId
            : null,
      sourceAccountName:
        input.status === "voided"
          ? before.sourceAccountName
          : directPayment
            ? sourceAccount?.displayName ?? before.sourceAccountName
            : null,
      sourceAccountType:
        input.status === "voided"
          ? before.sourceAccountType
          : directPayment
            ? sourceAccount?.accountType ?? before.sourceAccountType
            : null,
      totalAmount,
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

export async function voidExpense(
  pool: Pool,
  id: string,
  rawInput: VoidExpenseInput,
  context: SpendingWriteContext,
): Promise<Expense> {
  assertCanonicalUuid(id);
  const input = voidExpenseInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const before = await findExpenseForUpdate(connection, id);
    if (!before) throw new SpendingResourceNotFoundError();
    if (before.version !== input.version) throw new SpendingVersionConflictError();
    if (before.status === "voided") throw new ExpenseAlreadyVoidedError();
    const installments = await listExpenseInstallmentsForUpdate(connection, id);
    if (
      installments.some((item) => new Decimal(item.paidAmount).greaterThan(0))
    ) {
      throw new ExpensePlanLockedError();
    }
    if (before.financeTransactionId !== null) {
      requireAccountLedgerPermission(context);
      await reverseExpenseMovement(
        connection,
        before.financeTransactionId,
        Array.from(`Gider iptali: ${input.voidReason}`).slice(0, 2000).join(""),
        context,
        false,
      );
    }
    await deletePlannedExpenseInstallments(connection, id);
    const afterCandidate: Expense = {
      ...before,
      status: "voided",
      updatedAtUtc: now,
      version: before.version + 1,
      voidedAtUtc: now,
      voidReason: input.voidReason,
    };
    if (!(await updateExpenseRecord(connection, afterCandidate, input.version))) {
      throw new SpendingVersionConflictError();
    }
    const after = await findExpenseForUpdate(connection, id);
    if (!after) throw new SpendingResourceNotFoundError();
    await appendAuditEvent(connection, {
      action: "expense.voided",
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
    const installments = stored.map((item) => {
      const visible = installmentView(item, today);
      const { status } = visible;
      paidAmount = addMoney(paidAmount, item.paidAmount);
      if (status !== "paid") {
        openAmount = addMoney(openAmount, item.remainingAmount);
        if (status === "overdue") {
          overdueAmount = addMoney(overdueAmount, item.remainingAmount);
        } else {
          plannedAmount = addMoney(plannedAmount, item.remainingAmount);
        }
      }
      return visible;
    });
    return {
      cardSummaries: summarizeInstallmentsByCard(installments),
      installments,
      summary: { openAmount, overdueAmount, paidAmount, plannedAmount },
    };
  });
}

export async function bulkPayCardInstallments(
  pool: Pool,
  rawInput: BulkPayCardInstallmentsInput,
  context: SpendingWriteContext,
): Promise<BulkPayCardInstallmentsResult> {
  const input = bulkPayCardInstallmentsInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  const today = istanbulDate(nowDate);
  if (input.paidOn > today) throw new InstallmentPaymentDateInFutureError();
  requireAccountLedgerPermission(context);

  return withUtcTransaction(pool, async (connection) => {
    if (!(await findCreditCardForUpdate(connection, input.cardId))) {
      throw new SpendingResourceNotFoundError();
    }
    const locked = await listCardInstallmentsForBulkUpdate(
      connection,
      input.cardId,
      input.month,
    );
    const requested = new Map(
      input.installments.map((installment) => [installment.id, installment]),
    );
    const replayPayments = new Map<string, CardInstallmentPayment>();
    for (const expected of input.installments) {
      const payment = await findCardInstallmentPaymentByOperationKeyForUpdate(
        connection,
        expected.clientOperationKey,
      );
      if (payment !== null) replayPayments.set(expected.id, payment);
    }
    if (replayPayments.size > 0) {
      let replayedAmount = new Decimal(0);
      for (const expected of input.installments) {
        const installment = locked.find((candidate) => candidate.id === expected.id);
        const payment = replayPayments.get(expected.id);
        if (!installment) throw new CardInstallmentBulkConflictError();
        if (payment === undefined) {
          if (installment.version !== expected.version) {
            throw new CardInstallmentBulkConflictError();
          }
          continue;
        }
        if (
          payment.entryType !== "payment" ||
          payment.reversed ||
          payment.installmentId !== expected.id ||
          payment.paidOn !== input.paidOn ||
          payment.paymentAccountId !== input.sourceAccountId ||
          installment.version !== expected.version + 1
        ) {
          throw new SpendingIdempotencyConflictError();
        }
        replayedAmount = replayedAmount.plus(payment.amount);
      }
      if (!replayedAmount.equals(input.amount)) {
        throw new SpendingIdempotencyConflictError();
      }
      return {
        installments: locked
          .filter((installment) => requested.has(installment.id))
          .map((installment) => installmentView(installment, today)),
        replayed: true,
        updatedCount: 0,
      };
    }

    const open = locked.filter((installment) =>
      new Decimal(installment.remainingAmount).greaterThan(0),
    );
    if (
      open.length !== requested.size ||
      open.some(
        (installment) => requested.get(installment.id)?.version !== installment.version,
      )
    ) {
      throw new CardInstallmentBulkConflictError();
    }
    const periodRemaining = open.reduce(
      (total, installment) => total.plus(installment.remainingAmount),
      new Decimal(0),
    );
    if (new Decimal(input.amount).greaterThan(periodRemaining)) {
      throw new CardInstallmentPaymentExceedsRemainingError();
    }

    const paymentAccount = await selectedCardPaymentAccount(
      connection,
      input.sourceAccountId,
    );
    const updated: CardInstallment[] = [];
    let amountToAllocate = new Decimal(input.amount);
    for (const before of open) {
      if (amountToAllocate.isZero()) break;
      const allocation = Decimal.min(
        amountToAllocate,
        new Decimal(before.remainingAmount),
      ).toFixed(4);
      const expected = requested.get(before.id);
      if (!expected) throw new CardInstallmentBulkConflictError();
      await createCardInstallmentPaymentEntry(
        connection,
        before,
        {
          amount: allocation,
          clientOperationKey: expected.clientOperationKey,
          paidOn: input.paidOn,
          sourceAccountId: paymentAccount.id,
        },
        paymentAccount,
        now,
        context,
      );
      const paidAmount = new Decimal(before.paidAmount).plus(allocation);
      const remainingAmount = new Decimal(before.amount).minus(paidAmount);
      const fullyPaid = remainingAmount.isZero();
      const afterCandidate: CardInstallment = {
        ...before,
        hasPaymentHistory: true,
        paidAmount: paidAmount.toFixed(4),
        paidOn: fullyPaid ? input.paidOn : null,
        paymentAccountId: paymentAccount.id,
        paymentAccountName: paymentAccount.displayName,
        paymentAccountType: paymentAccount.accountType,
        remainingAmount: remainingAmount.toFixed(4),
        status: fullyPaid ? "paid" : "planned",
        updatedAtUtc: now,
        version: before.version + 1,
      };
      if (
        !(await updateCardInstallmentRecord(
          connection,
          afterCandidate,
          before.version,
        ))
      ) {
        throw new CardInstallmentBulkConflictError();
      }
      const after: CardInstallment = {
        ...afterCandidate,
        paidOn: input.paidOn,
      };
      await appendAuditEvent(connection, {
        action: "credit_card_installment.paid_bulk",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: installmentAuditSummary(after),
        beforeSummary: installmentAuditSummary(before),
        correlationId: context.correlationId,
        entityId: after.id,
        entityType: "credit_card_installment",
        occurredAtUtc: now,
      });
      updated.push(after);
      amountToAllocate = amountToAllocate.minus(allocation);
    }
    return {
      installments: updated.map((installment) => installmentView(installment, today)),
      replayed: false,
      updatedCount: updated.length,
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
  if (input.action === "pay" && input.paidOn > today) {
    throw new InstallmentPaymentDateInFutureError();
  }
  requireAccountLedgerPermission(context);
  return withUtcTransaction(pool, async (connection) => {
    const locked = await findCardInstallmentForUpdate(connection, id);
    if (!locked) {
      throw new SpendingResourceNotFoundError();
    }
    const { expenseStatus, ...before } = locked;
    if (expenseStatus !== "active") throw new SpendingResourceNotFoundError();
    if (input.action === "pay") {
      const replay = await findCardInstallmentPaymentByOperationKeyForUpdate(
        connection,
        input.clientOperationKey,
      );
      if (replay !== null) {
        if (
          !cardPaymentMatches(replay, {
            ...input,
            installmentId: before.id,
          }) ||
          replay.reversed
        ) {
          throw new SpendingIdempotencyConflictError();
        }
        return installmentView(before, today);
      }
      if (before.version !== input.version) {
        throw new SpendingVersionConflictError();
      }
      if (new Decimal(input.amount).greaterThan(before.remainingAmount)) {
        throw new CardInstallmentPaymentExceedsRemainingError();
      }
      const paymentAccount = await selectedCardPaymentAccount(
        connection,
        input.sourceAccountId,
      );
      await createCardInstallmentPaymentEntry(
        connection,
        before,
        input,
        paymentAccount,
        now,
        context,
      );
      const paidAmount = new Decimal(before.paidAmount).plus(input.amount);
      const remainingAmount = new Decimal(before.amount).minus(paidAmount);
      const fullyPaid = remainingAmount.isZero();
      const afterCandidate: CardInstallment = {
        ...before,
        hasPaymentHistory: true,
        paidAmount: paidAmount.toFixed(4),
        paidOn: fullyPaid ? input.paidOn : null,
        paymentAccountId: paymentAccount.id,
        paymentAccountName: paymentAccount.displayName,
        paymentAccountType: paymentAccount.accountType,
        remainingAmount: remainingAmount.toFixed(4),
        status: fullyPaid ? "paid" : "planned",
        updatedAtUtc: now,
        version: before.version + 1,
      };
      if (
        !(await updateCardInstallmentRecord(
          connection,
          afterCandidate,
          input.version,
        ))
      ) {
        throw new SpendingVersionConflictError();
      }
      const after: CardInstallment = {
        ...afterCandidate,
        paidOn: input.paidOn,
      };
      await appendAuditEvent(connection, {
        action: "credit_card_installment.payment_created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: installmentAuditSummary(after),
        beforeSummary: installmentAuditSummary(before),
        correlationId: context.correlationId,
        entityId: after.id,
        entityType: "credit_card_installment",
        occurredAtUtc: now,
      });
      return installmentView(after, today);
    }

    if (before.version !== input.version) throw new SpendingVersionConflictError();
    const payments = await listCardInstallmentPaymentsForUpdate(
      connection,
      before.id,
    );
    const activePayments = activeCardPayments(payments);
    const reason = "Kredi kartı taksit ödemesi plana geri alındı.";
    for (const payment of activePayments) {
      const clientOperationKey = randomUUID();
      const reversalFinanceTransactionId =
        payment.financeTransactionId === null
          ? null
          : await reverseCardPaymentMovement(
              connection,
              payment.financeTransactionId,
              clientOperationKey,
              reason,
              context,
            );
      await insertCardInstallmentPaymentRecordIdempotently(connection, {
        amount: payment.amount,
        clientOperationKey,
        createdAtUtc: now,
        entryType: "reversal",
        financeTransactionId: reversalFinanceTransactionId,
        id: randomUUID(),
        installmentId: before.id,
        paidOn: today,
        paymentAccountId: payment.paymentAccountId,
        paymentAccountName: payment.paymentAccountName,
        paymentAccountType: payment.paymentAccountType,
        reversalOfId: payment.id,
        reversalReason: reason,
        reversed: false,
      });
    }
    if (activePayments.length === 0 && before.financeTransactionId !== null) {
      await reverseCardPaymentMovement(
        connection,
        before.financeTransactionId,
        randomUUID(),
        reason,
        context,
      );
    }
    const afterCandidate: CardInstallment = {
      ...before,
      financeTransactionId: null,
      paidAmount: "0.0000",
      paidOn: null,
      paymentAccountId: null,
      paymentAccountName: null,
      paymentAccountType: null,
      remainingAmount: before.amount,
      status: "planned",
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateCardInstallmentRecord(connection, afterCandidate, input.version))) {
      throw new SpendingVersionConflictError();
    }
    const after = afterCandidate;
    await appendAuditEvent(connection, {
      action: "credit_card_installment.reopened",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: installmentAuditSummary(after),
      beforeSummary: installmentAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "credit_card_installment",
      occurredAtUtc: now,
    });
    return installmentView(after, today);
  });
}
