import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  type CreateFinanceAccountInput,
  createFinanceAccountInputSchema,
  type CreateFinanceTransactionInput,
  createFinanceTransactionInputSchema,
  type ReverseFinanceTransactionInput,
  reverseFinanceTransactionInputSchema,
  type UpdateFinanceAccountInput,
  updateFinanceAccountInputSchema,
} from "@/features/finance/account-validation";
import {
  findFinanceAccountBalanceRecord,
  findFinanceAccountByOperationKeyForUpdate,
  findFinanceAccountForUpdate,
  findCardInstallmentByFinanceTransactionForUpdate,
  findExpenseByFinanceTransactionForUpdate,
  findFinanceTransactionByOperationKeyForUpdate,
  findFinanceTransactionForUpdate,
  findFinanceTransactionReversalForUpdate,
  findReceivableCollectionByFinanceTransactionForUpdate,
  insertFinanceAccountRecordIdempotently,
  insertFinanceLedgerEntries,
  insertFinanceTransactionRecordIdempotently,
  listFinanceAccountBalanceRecords,
  listRecentFinanceTransactionRecords,
  lockFinanceAccounts,
  type FinanceAccountBalanceRecord,
  type FinanceAccountRecord,
  type FinanceLedgerSide,
  type FinanceTransactionOverviewRecord,
  type FinanceTransactionRecord,
  type FinanceTransactionType,
  updateFinanceAccountRecord,
} from "@/features/finance/account-repository";
import { istanbulDate } from "@/features/finance/period";
import { appendAuditEvent } from "@/platform/audit/repository";
import {
  withUtcConsistentRead,
  withUtcTransaction,
} from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class FinanceAccountNotFoundError extends Error {
  constructor() {
    super("The requested finance account was not found.");
    this.name = "FinanceAccountNotFoundError";
  }
}

export class FinanceAccountInactiveError extends Error {
  constructor() {
    super("An inactive finance account cannot receive new transactions.");
    this.name = "FinanceAccountInactiveError";
  }
}

export class FinanceAccountVersionConflictError extends Error {
  constructor() {
    super("The finance account was changed by another request.");
    this.name = "FinanceAccountVersionConflictError";
  }
}

export class FinanceAccountIdempotencyConflictError extends Error {
  constructor() {
    super("The client operation key is already bound to another account request.");
    this.name = "FinanceAccountIdempotencyConflictError";
  }
}

export class FinanceTransactionNotFoundError extends Error {
  constructor() {
    super("The requested finance transaction was not found.");
    this.name = "FinanceTransactionNotFoundError";
  }
}

export class FinanceTransactionIdempotencyConflictError extends Error {
  constructor() {
    super("The client operation key is already bound to another transaction request.");
    this.name = "FinanceTransactionIdempotencyConflictError";
  }
}

export class FinanceTransactionAlreadyReversedError extends Error {
  constructor() {
    super("The finance transaction already has a reversal.");
    this.name = "FinanceTransactionAlreadyReversedError";
  }
}

export class FinanceTransactionReversalNotAllowedError extends Error {
  constructor() {
    super("A reversal transaction cannot itself be reversed.");
    this.name = "FinanceTransactionReversalNotAllowedError";
  }
}

export class FinanceTransactionFutureDateError extends Error {
  constructor() {
    super("A finance transaction cannot be recorded in the future.");
    this.name = "FinanceTransactionFutureDateError";
  }
}

export class FinanceTransactionBeforeAccountOpeningError extends Error {
  constructor() {
    super("A finance transaction cannot predate an affected account.");
    this.name = "FinanceTransactionBeforeAccountOpeningError";
  }
}

export class FinanceTransactionManagedByExpenseError extends Error {
  constructor() {
    super("A managed transaction must be corrected from its source record.");
    this.name = "FinanceTransactionManagedByExpenseError";
  }
}

export type FinanceAccountWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

export type FinanceAccountView = Readonly<{
  accountType: "bank" | "cash";
  balanceAmount: string;
  bankName: string | null;
  currency: "TRY";
  displayName: string;
  id: string;
  openedOn: string;
  openingBalanceAmount: string;
  status: "active" | "inactive";
  version: number;
}>;

export type FinanceTransactionView = Readonly<{
  amount: string;
  currency: "TRY";
  description: string;
  id: string;
  isReversal: boolean;
  occurredOn: string;
  reversed: boolean;
  sourceAccount: Readonly<{ id: string; name: string }> | null;
  targetAccount: Readonly<{ id: string; name: string }> | null;
  transactionType: FinanceTransactionType;
}>;

export type FinanceAccountsOverview = Readonly<{
  accounts: readonly FinanceAccountView[];
  recentTransactions: readonly FinanceTransactionView[];
  summary: Readonly<{
    accountCount: number;
    activeAccountCount: number;
    bankBalanceAmount: string;
    cashBalanceAmount: string;
    currency: "TRY";
    totalLiquidBalance: string;
  }>;
}>;

function fixedMoney(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function accountOpenedOn(createdAtUtc: string): string {
  const instant = new Date(
    `${createdAtUtc.slice(0, 23).replace(" ", "T")}Z`,
  );
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Finance account creation timestamp is invalid.");
  }
  return istanbulDate(instant);
}

function accountView(account: FinanceAccountBalanceRecord): FinanceAccountView {
  return {
    accountType: account.accountType,
    balanceAmount: fixedMoney(account.balanceAmount),
    bankName: account.bankName,
    currency: "TRY",
    displayName: account.displayName,
    id: account.id,
    openedOn: accountOpenedOn(account.createdAtUtc),
    openingBalanceAmount: fixedMoney(account.openingBalanceAmount),
    status: account.status,
    version: account.version,
  };
}

function namedAccount(
  accounts: readonly FinanceAccountRecord[],
  accountId: string | null,
): Readonly<{ id: string; name: string }> | null {
  if (accountId === null) return null;
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new FinanceAccountNotFoundError();
  return { id: account.id, name: account.displayName };
}

function transactionView(
  transaction: FinanceTransactionRecord,
  accounts: readonly FinanceAccountRecord[],
  reversed = false,
): FinanceTransactionView {
  return {
    amount: fixedMoney(transaction.amount),
    currency: "TRY",
    description: transaction.description,
    id: transaction.id,
    isReversal: transaction.reversalOfId !== null,
    occurredOn: transaction.occurredOn,
    reversed,
    sourceAccount: namedAccount(accounts, transaction.sourceAccountId),
    targetAccount: namedAccount(accounts, transaction.targetAccountId),
    transactionType: transaction.transactionType,
  };
}

function overviewTransactionView(
  transaction: FinanceTransactionOverviewRecord,
): FinanceTransactionView {
  return {
    amount: fixedMoney(transaction.amount),
    currency: "TRY",
    description: transaction.description,
    id: transaction.id,
    isReversal: transaction.reversalOfId !== null,
    occurredOn: transaction.occurredOn,
    reversed: transaction.reversed,
    sourceAccount:
      transaction.sourceAccountId === null || transaction.sourceAccountName === null
        ? null
        : { id: transaction.sourceAccountId, name: transaction.sourceAccountName },
    targetAccount:
      transaction.targetAccountId === null || transaction.targetAccountName === null
        ? null
        : { id: transaction.targetAccountId, name: transaction.targetAccountName },
    transactionType: transaction.transactionType,
  };
}

function accountMatches(
  account: FinanceAccountRecord,
  input: CreateFinanceAccountInput,
): boolean {
  return (
    account.accountType === input.accountType &&
    account.bankName === input.bankName &&
    account.clientOperationKey === input.clientOperationKey &&
    account.displayName === input.displayName &&
    account.openingBalanceAmount === input.openingBalanceAmount &&
    account.status === input.status
  );
}

function transactionMatches(
  transaction: FinanceTransactionRecord,
  input: CreateFinanceTransactionInput,
): boolean {
  return (
    transaction.amount === input.amount &&
    transaction.clientOperationKey === input.clientOperationKey &&
    transaction.description === input.description &&
    transaction.occurredOn === input.occurredOn &&
    transaction.reversalOfId === null &&
    transaction.reversalReason === null &&
    transaction.sourceAccountId === input.sourceAccountId &&
    transaction.targetAccountId === input.targetAccountId &&
    transaction.transactionType === input.transactionType
  );
}

function accountIds(transaction: FinanceTransactionRecord): string[] {
  return [transaction.sourceAccountId, transaction.targetAccountId].filter(
    (id): id is string => id !== null,
  );
}

function assertTransactionOnOrAfterAccountOpening(
  transaction: FinanceTransactionRecord,
  accounts: readonly FinanceAccountRecord[],
): void {
  if (
    accounts.some(
      (account) => transaction.occurredOn < accountOpenedOn(account.createdAtUtc),
    )
  ) {
    throw new FinanceTransactionBeforeAccountOpeningError();
  }
}

function ledgerEntries(transaction: FinanceTransactionRecord, now: string) {
  const entries: Array<Readonly<{ accountId: string; entrySide: FinanceLedgerSide }>> = [];
  if (transaction.sourceAccountId !== null) {
    entries.push({ accountId: transaction.sourceAccountId, entrySide: "outflow" });
  }
  if (transaction.targetAccountId !== null) {
    entries.push({ accountId: transaction.targetAccountId, entrySide: "inflow" });
  }
  return entries.map((entry) => ({
    ...entry,
    amount: transaction.amount,
    createdAtUtc: now,
    currency: "TRY" as const,
    id: randomUUID(),
    transactionId: transaction.id,
  }));
}

function accountAuditSummary(account: FinanceAccountRecord) {
  return {
    accountType: account.accountType,
    bankName: account.bankName,
    displayName: account.displayName,
    openingBalanceAmount: account.openingBalanceAmount,
    status: account.status,
    version: account.version,
  };
}

function transactionAuditSummary(transaction: FinanceTransactionRecord) {
  return {
    amount: transaction.amount,
    description: transaction.description,
    occurredOn: transaction.occurredOn,
    reversalOfId: transaction.reversalOfId,
    sourceAccountId: transaction.sourceAccountId,
    targetAccountId: transaction.targetAccountId,
    transactionType: transaction.transactionType,
  };
}

function oppositeTransaction(
  original: FinanceTransactionRecord,
  input: ReverseFinanceTransactionInput,
  now: string,
  occurredOn: string,
): FinanceTransactionRecord {
  const description = Array.from(`Ters kayıt: ${original.description}`)
    .slice(0, 191)
    .join("");
  const common = {
    amount: original.amount,
    clientOperationKey: input.clientOperationKey,
    createdAtUtc: now,
    currency: "TRY" as const,
    description,
    id: randomUUID(),
    occurredOn,
    reversalOfId: original.id,
    reversalReason: input.reason,
  };
  if (original.transactionType === "income") {
    return {
      ...common,
      sourceAccountId: original.targetAccountId,
      targetAccountId: null,
      transactionType: "expense",
    };
  }
  if (original.transactionType === "expense") {
    return {
      ...common,
      sourceAccountId: null,
      targetAccountId: original.sourceAccountId,
      transactionType: "income",
    };
  }
  return {
    ...common,
    sourceAccountId: original.targetAccountId,
    targetAccountId: original.sourceAccountId,
    transactionType: "transfer",
  };
}

async function transactionAccounts(
  connection: Parameters<typeof lockFinanceAccounts>[0],
  transaction: FinanceTransactionRecord,
  requireActive: boolean,
): Promise<readonly FinanceAccountRecord[]> {
  const ids = [...new Set(accountIds(transaction))];
  const accounts = await lockFinanceAccounts(connection, ids);
  if (accounts.length !== ids.length) throw new FinanceAccountNotFoundError();
  if (requireActive && accounts.some((account) => account.status !== "active")) {
    throw new FinanceAccountInactiveError();
  }
  return accounts;
}

export async function listFinanceAccountsOverview(
  pool: Pool,
): Promise<FinanceAccountsOverview> {
  return withUtcConsistentRead(pool, async (connection) => {
    const records = await listFinanceAccountBalanceRecords(connection);
    const recent = await listRecentFinanceTransactionRecords(connection);
    let bankBalance = new Decimal(0);
    let cashBalance = new Decimal(0);
    for (const account of records) {
      const balance = new Decimal(account.balanceAmount);
      if (account.accountType === "bank") bankBalance = bankBalance.plus(balance);
      else cashBalance = cashBalance.plus(balance);
    }
    return {
      accounts: records.map(accountView),
      recentTransactions: recent.map(overviewTransactionView),
      summary: {
        accountCount: records.length,
        activeAccountCount: records.filter((account) => account.status === "active").length,
        bankBalanceAmount: fixedMoney(bankBalance.toString()),
        cashBalanceAmount: fixedMoney(cashBalance.toString()),
        currency: "TRY",
        totalLiquidBalance: fixedMoney(bankBalance.plus(cashBalance).toString()),
      },
    };
  });
}

export async function createFinanceAccount(
  pool: Pool,
  rawInput: CreateFinanceAccountInput,
  context: FinanceAccountWriteContext,
): Promise<Readonly<{ account: FinanceAccountView; created: boolean }>> {
  const input = createFinanceAccountInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const replay = await findFinanceAccountByOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay && !accountMatches(replay, input)) {
      throw new FinanceAccountIdempotencyConflictError();
    }
    if (replay) {
      const balanced = await findFinanceAccountBalanceRecord(connection, replay.id);
      if (!balanced) throw new FinanceAccountNotFoundError();
      return { account: accountView(balanced), created: false };
    }
    const pending: FinanceAccountRecord = {
      ...input,
      createdAtUtc: now,
      currency: "TRY",
      id: randomUUID(),
      updatedAtUtc: now,
      version: 1,
    };
    const persisted = await insertFinanceAccountRecordIdempotently(
      connection,
      pending,
    );
    if (!accountMatches(persisted, input)) {
      throw new FinanceAccountIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      await appendAuditEvent(connection, {
        action: "finance_account.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: accountAuditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "finance_account",
        occurredAtUtc: now,
      });
    }
    const balanced = await findFinanceAccountBalanceRecord(connection, persisted.id);
    if (!balanced) throw new FinanceAccountNotFoundError();
    return { account: accountView(balanced), created };
  });
}

export async function updateFinanceAccount(
  pool: Pool,
  id: string,
  rawInput: UpdateFinanceAccountInput,
  context: FinanceAccountWriteContext,
): Promise<FinanceAccountView> {
  assertCanonicalUuid(id);
  const input = updateFinanceAccountInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  return withUtcTransaction(pool, async (connection) => {
    const before = await findFinanceAccountForUpdate(connection, id);
    if (!before) throw new FinanceAccountNotFoundError();
    if (before.version !== input.version) {
      throw new FinanceAccountVersionConflictError();
    }
    const after: FinanceAccountRecord = {
      ...before,
      accountType: input.accountType,
      bankName: input.bankName,
      displayName: input.displayName,
      status: input.status,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateFinanceAccountRecord(connection, after, input.version))) {
      throw new FinanceAccountVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action:
        after.status === "inactive" && before.status !== "inactive"
          ? "finance_account.deactivated"
          : "finance_account.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: accountAuditSummary(after),
      beforeSummary: accountAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "finance_account",
      occurredAtUtc: now,
    });
    const balanced = await findFinanceAccountBalanceRecord(connection, after.id);
    if (!balanced) throw new FinanceAccountNotFoundError();
    return accountView(balanced);
  });
}

export async function createFinanceTransactionInConnection(
  connection: PoolConnection,
  rawInput: CreateFinanceTransactionInput,
  context: FinanceAccountWriteContext,
): Promise<Readonly<{ created: boolean; transaction: FinanceTransactionView }>> {
  const input = createFinanceTransactionInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  if (input.occurredOn > istanbulDate(nowDate)) {
    throw new FinanceTransactionFutureDateError();
  }
  const now = toUtcDateTime6(nowDate);
  const replay = await findFinanceTransactionByOperationKeyForUpdate(
    connection,
    input.clientOperationKey,
  );
  if (replay && !transactionMatches(replay, input)) {
    throw new FinanceTransactionIdempotencyConflictError();
  }
  if (replay) {
    const accounts = await transactionAccounts(connection, replay, false);
    return { created: false, transaction: transactionView(replay, accounts) };
  }
  const pending: FinanceTransactionRecord = {
    ...input,
    createdAtUtc: now,
    currency: "TRY",
    id: randomUUID(),
    reversalOfId: null,
    reversalReason: null,
  };
  const accounts = await transactionAccounts(connection, pending, true);
  assertTransactionOnOrAfterAccountOpening(pending, accounts);
  const persisted = await insertFinanceTransactionRecordIdempotently(
    connection,
    pending,
  );
  if (!transactionMatches(persisted, input)) {
    throw new FinanceTransactionIdempotencyConflictError();
  }
  const created = persisted.id === pending.id;
  if (created) {
    await insertFinanceLedgerEntries(connection, ledgerEntries(persisted, now));
    await appendAuditEvent(connection, {
      action: "finance_transaction.created",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: transactionAuditSummary(persisted),
      correlationId: context.correlationId,
      entityId: persisted.id,
      entityType: "finance_transaction",
      occurredAtUtc: now,
    });
  }
  return { created, transaction: transactionView(persisted, accounts) };
}

export async function createFinanceTransaction(
  pool: Pool,
  rawInput: CreateFinanceTransactionInput,
  context: FinanceAccountWriteContext,
): Promise<Readonly<{ created: boolean; transaction: FinanceTransactionView }>> {
  return withUtcTransaction(pool, (connection) =>
    createFinanceTransactionInConnection(connection, rawInput, context),
  );
}

export async function reverseFinanceTransactionInConnection(
  connection: PoolConnection,
  id: string,
  rawInput: ReverseFinanceTransactionInput,
  context: FinanceAccountWriteContext,
  options: Readonly<{
    allowExpenseManaged?: boolean;
    preserveOriginalDate?: boolean;
  }> = {},
): Promise<Readonly<{ created: boolean; transaction: FinanceTransactionView }>> {
  assertCanonicalUuid(id);
  const input = reverseFinanceTransactionInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  const now = toUtcDateTime6(nowDate);
  if (
    options.allowExpenseManaged !== true &&
    ((await findExpenseByFinanceTransactionForUpdate(connection, id)) !== null ||
      (await findReceivableCollectionByFinanceTransactionForUpdate(
        connection,
        id,
      )) !== null ||
      (await findCardInstallmentByFinanceTransactionForUpdate(
        connection,
        id,
      )) !== null)
  ) {
    throw new FinanceTransactionManagedByExpenseError();
  }
  const replay = await findFinanceTransactionByOperationKeyForUpdate(
    connection,
    input.clientOperationKey,
  );
  if (replay) {
    if (replay.reversalOfId !== id || replay.reversalReason !== input.reason) {
      throw new FinanceTransactionIdempotencyConflictError();
    }
    const accounts = await transactionAccounts(connection, replay, false);
    return { created: false, transaction: transactionView(replay, accounts) };
  }
  const original = await findFinanceTransactionForUpdate(connection, id);
  if (!original) throw new FinanceTransactionNotFoundError();
  if (original.reversalOfId !== null) {
    throw new FinanceTransactionReversalNotAllowedError();
  }
  if (await findFinanceTransactionReversalForUpdate(connection, original.id)) {
    throw new FinanceTransactionAlreadyReversedError();
  }
  const pending = oppositeTransaction(
    original,
    input,
    now,
    options.preserveOriginalDate === true
      ? original.occurredOn
      : istanbulDate(nowDate),
  );
  const accounts = await transactionAccounts(connection, pending, false);
  const persisted = await insertFinanceTransactionRecordIdempotently(
    connection,
    pending,
  );
  if (persisted.reversalOfId !== original.id) {
    throw new FinanceTransactionIdempotencyConflictError();
  }
  if (persisted.clientOperationKey !== input.clientOperationKey) {
    throw new FinanceTransactionAlreadyReversedError();
  }
  if (persisted.reversalReason !== input.reason) {
    throw new FinanceTransactionIdempotencyConflictError();
  }
  const created = persisted.id === pending.id;
  if (created) {
    await insertFinanceLedgerEntries(connection, ledgerEntries(persisted, now));
    await appendAuditEvent(connection, {
      action: "finance_transaction.reversed",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: {
        ...transactionAuditSummary(original),
        reversalId: persisted.id,
        reversalReason: input.reason,
      },
      correlationId: context.correlationId,
      entityId: original.id,
      entityType: "finance_transaction",
      occurredAtUtc: now,
    });
  }
  return { created, transaction: transactionView(persisted, accounts) };
}

export async function reverseFinanceTransaction(
  pool: Pool,
  id: string,
  rawInput: ReverseFinanceTransactionInput,
  context: FinanceAccountWriteContext,
): Promise<Readonly<{ created: boolean; transaction: FinanceTransactionView }>> {
  return withUtcTransaction(pool, (connection) =>
    reverseFinanceTransactionInConnection(connection, id, rawInput, context),
  );
}
