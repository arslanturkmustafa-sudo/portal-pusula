import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  type PasswordChangeInput,
  passwordChangeInputSchema,
} from "@/features/account/validation";
import {
  countUserAccounts,
  findUserAccountByEmail,
  findUserAccountById,
  findUserAccountForUpdate,
  insertUserAccount,
  type UserAccount,
  updateUserAccountPassword,
} from "@/features/account/repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import {
  hashPassword,
  verifyAdminCredentials,
  verifyPassword,
} from "@/platform/auth/password";
import type { AuthEnvironment } from "@/platform/config/auth-env.schema";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super("Current password is invalid.");
    this.name = "CurrentPasswordInvalidError";
  }
}

export class AccountInitializationConflictError extends Error {
  constructor() {
    super("The first account has already been initialized.");
    this.name = "AccountInitializationConflictError";
  }
}

export class AccountSessionInvalidError extends Error {
  constructor() {
    super("The account session is no longer valid.");
    this.name = "AccountSessionInvalidError";
  }
}

export type AccountWriteContext = Readonly<{
  correlationId: string;
  now?: Date;
}>;

export type AccountSummary = Readonly<{
  email: string;
  passwordChangedAtUtc: string | null;
  requiresCurrentPassword: boolean;
}>;

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeAuditSummary(account: UserAccount) {
  return {
    credentialVersion: account.credentialVersion,
    email: account.email,
    passwordChangedAtUtc: account.passwordChangedAtUtc,
    status: account.status,
  };
}

async function accountSnapshot(
  pool: Pool,
  email: string,
): Promise<Readonly<{ account: UserAccount | null; count: number }>> {
  return withUtcTransaction(pool, async (connection) => ({
    account: await findUserAccountByEmail(connection, email),
    count: await countUserAccounts(connection),
  }));
}

async function createBootstrapAccount(
  pool: Pool,
  environment: AuthEnvironment,
  context: AccountWriteContext,
): Promise<UserAccount> {
  const now = toUtcDateTime6(context.now ?? new Date());
  const account: UserAccount = {
    createdAtUtc: now,
    credentialVersion: 1,
    email: environment.ADMIN_EMAIL,
    id: randomUUID(),
    passwordChangedAtUtc: now,
    passwordHash: environment.ADMIN_PASSWORD_HASH,
    status: "active",
    updatedAtUtc: now,
  };

  return withUtcTransaction(pool, async (connection) => {
    if ((await countUserAccounts(connection)) !== 0) {
      throw new AccountInitializationConflictError();
    }
    await insertUserAccount(connection, account);
    await appendAuditEvent(connection, {
      action: "account.created",
      actorId: account.id,
      actorType: "user",
      afterSummary: safeAuditSummary(account),
      correlationId: context.correlationId,
      entityId: account.id,
      entityType: "user_account",
      occurredAtUtc: now,
    });
    return account;
  });
}

export async function authenticateAccountLogin(
  pool: Pool,
  email: string,
  password: string,
  environment: AuthEnvironment,
  context: AccountWriteContext,
): Promise<UserAccount | null> {
  const normalizedEmail = canonicalEmail(email);
  const snapshot = await accountSnapshot(pool, normalizedEmail);

  if (snapshot.count === 0) {
    if (!(await verifyAdminCredentials(email, password, environment))) {
      return null;
    }
    try {
      return await createBootstrapAccount(pool, environment, context);
    } catch (error) {
      if (!(error instanceof AccountInitializationConflictError) && !isDuplicateEntry(error)) {
        throw error;
      }
      const retry = await accountSnapshot(pool, normalizedEmail);
      if (!retry.account || retry.account.status !== "active") return null;
      return (await verifyPassword(password, retry.account.passwordHash))
        ? retry.account
        : null;
    }
  }

  const hashForConstantWork =
    snapshot.account?.passwordHash ?? environment.ADMIN_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(password, hashForConstantWork);
  if (
    !snapshot.account ||
    snapshot.account.status !== "active" ||
    !passwordMatches
  ) {
    return null;
  }
  return snapshot.account;
}

export async function validateAccountSession(
  pool: Pool,
  accountId: string,
  credentialVersion: number,
): Promise<UserAccount | null> {
  assertCanonicalUuid(accountId);
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 1) {
    return null;
  }
  const account = await withUtcTransaction(pool, (connection) =>
    findUserAccountById(connection, accountId),
  );
  return account?.status === "active" &&
    account.credentialVersion === credentialVersion
    ? account
    : null;
}

export async function canUseLegacySession(pool: Pool): Promise<boolean> {
  return withUtcTransaction(
    pool,
    async (connection) => (await countUserAccounts(connection)) === 0,
  );
}

export function accountSummary(account: UserAccount): AccountSummary {
  return {
    email: account.email,
    passwordChangedAtUtc: account.passwordChangedAtUtc,
    requiresCurrentPassword: true,
  };
}

export function legacyAccountSummary(
  environment: AuthEnvironment,
): AccountSummary {
  return {
    email: environment.ADMIN_EMAIL,
    passwordChangedAtUtc: null,
    requiresCurrentPassword: false,
  };
}

export async function initializeAccountFromLegacySession(
  pool: Pool,
  rawInput: PasswordChangeInput,
  environment: AuthEnvironment,
  context: AccountWriteContext,
): Promise<UserAccount> {
  const input = passwordChangeInputSchema.parse(rawInput);
  const passwordHash = await hashPassword(input.newPassword);
  const now = toUtcDateTime6(context.now ?? new Date());
  const account: UserAccount = {
    createdAtUtc: now,
    credentialVersion: 1,
    email: environment.ADMIN_EMAIL,
    id: randomUUID(),
    passwordChangedAtUtc: now,
    passwordHash,
    status: "active",
    updatedAtUtc: now,
  };

  return withUtcTransaction(pool, async (connection) => {
    if ((await countUserAccounts(connection)) !== 0) {
      throw new AccountInitializationConflictError();
    }
    await insertUserAccount(connection, account);
    await appendAuditEvent(connection, {
      action: "account.created",
      actorId: account.id,
      actorType: "user",
      afterSummary: safeAuditSummary(account),
      correlationId: context.correlationId,
      entityId: account.id,
      entityType: "user_account",
      occurredAtUtc: now,
    });
    return account;
  });
}

export async function changeAccountPassword(
  pool: Pool,
  accountId: string,
  expectedCredentialVersion: number,
  rawInput: PasswordChangeInput,
  context: AccountWriteContext,
): Promise<UserAccount> {
  assertCanonicalUuid(accountId);
  const input = passwordChangeInputSchema.parse(rawInput);
  if (input.currentPassword === undefined) {
    throw new CurrentPasswordInvalidError();
  }

  const before = await withUtcTransaction(pool, (connection) =>
    findUserAccountById(connection, accountId),
  );
  if (
    !before ||
    before.status !== "active" ||
    before.credentialVersion !== expectedCredentialVersion
  ) {
    throw new AccountSessionInvalidError();
  }
  if (!(await verifyPassword(input.currentPassword, before.passwordHash))) {
    throw new CurrentPasswordInvalidError();
  }

  const passwordHash = await hashPassword(input.newPassword);
  const now = toUtcDateTime6(context.now ?? new Date());
  const after: UserAccount = {
    ...before,
    credentialVersion: before.credentialVersion + 1,
    passwordChangedAtUtc: now,
    passwordHash,
    updatedAtUtc: now,
  };

  return withUtcTransaction(pool, async (connection) => {
    const locked = await findUserAccountForUpdate(connection, accountId);
    if (
      !locked ||
      locked.status !== "active" ||
      locked.credentialVersion !== before.credentialVersion ||
      locked.passwordHash !== before.passwordHash
    ) {
      throw new AccountSessionInvalidError();
    }
    if (
      !(await updateUserAccountPassword(connection, {
        credentialVersion: after.credentialVersion,
        expectedCredentialVersion: before.credentialVersion,
        id: after.id,
        passwordChangedAtUtc: now,
        passwordHash,
        updatedAtUtc: now,
      }))
    ) {
      throw new AccountSessionInvalidError();
    }
    await appendAuditEvent(connection, {
      action: "account.password_changed",
      actorId: after.id,
      actorType: "user",
      afterSummary: safeAuditSummary(after),
      beforeSummary: safeAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "user_account",
      occurredAtUtc: now,
    });
    return after;
  });
}
