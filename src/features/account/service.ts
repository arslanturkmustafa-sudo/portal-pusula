import { readUserProjectScope, replaceUserProjectScope } from "./project-access-repository";
import type { ProjectScope } from "@/platform/auth/project-access";
import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  type PasswordChangeInput,
  passwordChangeInputSchema,
} from "@/features/account/validation";
import {
  type CreateManagedUserInput,
  createManagedUserInputSchema,
  type UpdateManagedUserInput,
  updateManagedUserInputSchema,
} from "@/features/account/user-management-validation";
import {
  countUserAccounts,
  findUserAccountByEmail,
  findUserAccountById,
  findUserAccountForUpdate,
  insertUserAccount,
  listUserPermissionCodes,
  listAllUserPermissions,
  listUserAccounts,
  replaceUserPermissions,
  type UserAccount,
  updateUserAccountPassword,
  updateUserAccountStatus,
} from "@/features/account/repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import {
  hashPassword,
  verifyAdminCredentials,
  verifyPassword,
} from "@/platform/auth/password";
import type { PermissionCode } from "@/platform/auth/permissions";
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

export class ManagedUserEmailConflictError extends Error {
  constructor() {
    super("The user email is already in use.");
    this.name = "ManagedUserEmailConflictError";
  }
}

export class ManagedUserNotFoundError extends Error {
  constructor() {
    super("The managed user was not found.");
    this.name = "ManagedUserNotFoundError";
  }
}

export class ManagedUserOwnerProtectedError extends Error {
  constructor() {
    super("Owner access cannot be changed through member management.");
    this.name = "ManagedUserOwnerProtectedError";
  }
}

export class ManagedUserVersionConflictError extends Error {
  constructor() {
    super("The managed user changed in another request.");
    this.name = "ManagedUserVersionConflictError";
  }
}

export type AccountWriteContext = Readonly<{
  correlationId: string;
  now?: Date;
}>;

export type AccountSummary = Readonly<{
  displayName: string;
  email: string;
  passwordChangedAtUtc: string | null;
  requiresCurrentPassword: boolean;
  role: UserAccount["role"];
}>;

export type ValidatedAccountSession = Readonly<{
  account: UserAccount;
  permissions: readonly PermissionCode[];
  projectIds?: ProjectScope;
}>;

export type ManagedUser = Readonly<{
  createdAtUtc: string;
  credentialVersion: number;
  displayName: string;
  email: string;
  id: string;
  permissions: readonly PermissionCode[];
  projectIds?: ProjectScope;
  role: UserAccount["role"];
  status: UserAccount["status"];
  updatedAtUtc: string;
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

function managedUser(
  account: UserAccount,
  permissions: readonly PermissionCode[],
  projectIds: ProjectScope = null,
): ManagedUser {
  return {
    createdAtUtc: account.createdAtUtc,
    credentialVersion: account.credentialVersion,
    displayName: account.displayName,
    email: account.email,
    id: account.id,
    permissions,
    projectIds,
    role: account.role,
    status: account.status,
    updatedAtUtc: account.updatedAtUtc,
  };
}

export async function listManagedUsers(pool: Pool): Promise<readonly ManagedUser[]> {
  return withUtcTransaction(pool, async (connection) => {
    const [accounts, permissions] = await Promise.all([
      listUserAccounts(connection),
      listAllUserPermissions(connection),
    ]);
    return Promise.all(accounts.map(async (account) =>
      managedUser(account, permissions.get(account.id) ?? [], await readUserProjectScope(connection, account.id)),
    ));
  });
}

export async function createManagedUser(
  pool: Pool,
  rawInput: CreateManagedUserInput,
  context: AccountWriteContext & Readonly<{ actorId: string }>,
): Promise<ManagedUser> {
  const input = createManagedUserInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());
  const account: UserAccount = {
    createdAtUtc: now,
    credentialVersion: 1,
    displayName: input.displayName,
    email: input.email,
    id: randomUUID(),
    passwordChangedAtUtc: now,
    passwordHash: await hashPassword(input.password),
    role: "member",
    status: "active",
    updatedAtUtc: now,
  };

  try {
    return await withUtcTransaction(pool, async (connection) => {
      await insertUserAccount(connection, account);
      await replaceUserPermissions(connection, account.id, input.permissions, now);
      await replaceUserProjectScope(connection, account.id, input.projectIds === undefined ? [] : input.projectIds);
      await appendAuditEvent(connection, {
        action: "account.member_created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: {
          ...safeAuditSummary(account),
          displayName: account.displayName,
          permissions: input.permissions,
          projectIds: input.projectIds === undefined ? [] : input.projectIds,
          role: account.role,
        },
        correlationId: context.correlationId,
        entityId: account.id,
        entityType: "user_account",
        occurredAtUtc: now,
      });
      return managedUser(account, input.permissions, input.projectIds === undefined ? [] : input.projectIds);
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new ManagedUserEmailConflictError();
    throw error;
  }
}

export async function updateManagedUser(
  pool: Pool,
  userAccountId: string,
  rawInput: UpdateManagedUserInput,
  context: AccountWriteContext & Readonly<{ actorId: string }>,
): Promise<ManagedUser> {
  assertCanonicalUuid(userAccountId);
  const input = updateManagedUserInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findUserAccountForUpdate(connection, userAccountId);
    if (!before) throw new ManagedUserNotFoundError();
    if (before.role === "owner" || before.id === context.actorId) {
      throw new ManagedUserOwnerProtectedError();
    }
    const after: UserAccount = {
      ...before,
      credentialVersion: before.credentialVersion + 1,
      status: input.status,
      updatedAtUtc: now,
    };
    if (
      !(await updateUserAccountStatus(connection, {
        credentialVersion: after.credentialVersion,
        expectedCredentialVersion: before.credentialVersion,
        id: after.id,
        status: after.status,
        updatedAtUtc: now,
      }))
    ) {
      throw new ManagedUserVersionConflictError();
    }
    await replaceUserPermissions(connection, after.id, input.permissions, now);
    const projectIds = input.projectIds === undefined ? await readUserProjectScope(connection, after.id) : input.projectIds;
    await replaceUserProjectScope(connection, after.id, projectIds);
    await appendAuditEvent(connection, {
      action: "account.member_access_updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: {
        credentialVersion: after.credentialVersion,
        permissions: input.permissions,
        projectIds,
        status: after.status,
      },
      beforeSummary: {
        credentialVersion: before.credentialVersion,
        status: before.status,
      },
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "user_account",
      occurredAtUtc: now,
    });
    return managedUser(after, input.permissions, projectIds);
  });
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
    displayName: "Portal Yöneticisi",
    email: environment.ADMIN_EMAIL,
    id: randomUUID(),
    passwordChangedAtUtc: now,
    passwordHash: environment.ADMIN_PASSWORD_HASH,
    role: "owner",
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

export async function validateAccountPrincipalSession(
  pool: Pool,
  accountId: string,
  credentialVersion: number,
): Promise<ValidatedAccountSession | null> {
  assertCanonicalUuid(accountId);
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 1) {
    return null;
  }
  return withUtcTransaction(pool, async (connection) => {
    const account = await findUserAccountById(connection, accountId);
    if (
      account?.status !== "active" ||
      account.credentialVersion !== credentialVersion
    ) {
      return null;
    }
    return {
      account,
      permissions: await listUserPermissionCodes(connection, account.id),
      projectIds: await readUserProjectScope(connection, account.id),
    };
  });
}

export async function canUseLegacySession(pool: Pool): Promise<boolean> {
  return withUtcTransaction(
    pool,
    async (connection) => (await countUserAccounts(connection)) === 0,
  );
}

export function accountSummary(account: UserAccount): AccountSummary {
  return {
    displayName: account.displayName,
    email: account.email,
    passwordChangedAtUtc: account.passwordChangedAtUtc,
    requiresCurrentPassword: true,
    role: account.role,
  };
}

export function legacyAccountSummary(
  environment: AuthEnvironment,
): AccountSummary {
  return {
    displayName: "Portal Yöneticisi",
    email: environment.ADMIN_EMAIL,
    passwordChangedAtUtc: null,
    requiresCurrentPassword: false,
    role: "owner",
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
    displayName: "Portal Yöneticisi",
    email: environment.ADMIN_EMAIL,
    id: randomUUID(),
    passwordChangedAtUtc: now,
    passwordHash,
    role: "owner",
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
