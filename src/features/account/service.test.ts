// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  countUserAccounts: vi.fn(),
  findUserAccountByEmail: vi.fn(),
  findUserAccountById: vi.fn(),
  findUserAccountForUpdate: vi.fn(),
  hashPassword: vi.fn(),
  insertUserAccount: vi.fn(),
  updateUserAccountPassword: vi.fn(),
  verifyAdminCredentials: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/features/account/repository", () => ({
  countUserAccounts: mocks.countUserAccounts,
  findUserAccountByEmail: mocks.findUserAccountByEmail,
  findUserAccountById: mocks.findUserAccountById,
  findUserAccountForUpdate: mocks.findUserAccountForUpdate,
  insertUserAccount: mocks.insertUserAccount,
  updateUserAccountPassword: mocks.updateUserAccountPassword,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/auth/password", () => ({
  hashPassword: mocks.hashPassword,
  verifyAdminCredentials: mocks.verifyAdminCredentials,
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  authenticateAccountLogin,
  changeAccountPassword,
  CurrentPasswordInvalidError,
} from "@/features/account/service";

const account = {
  createdAtUtc: "2026-09-01 09:00:00.000000",
  credentialVersion: 1,
  email: "yonetici@example.com",
  id: "11111111-1111-4111-8111-111111111111",
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
  passwordHash: "stored-password-hash-sentinel",
  status: "active" as const,
  updatedAtUtc: "2026-09-01 09:00:00.000000",
};
const environment = {
  ADMIN_EMAIL: account.email,
  ADMIN_PASSWORD_HASH: "environment-password-hash-sentinel",
  SESSION_SECRET: "AbcdEFgh12345678",
};
const context = {
  correlationId: "account-service-test",
  now: new Date("2026-09-02T09:00:00.000Z"),
};
const pool = {} as Pool;

describe("account service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countUserAccounts.mockResolvedValue(1);
    mocks.findUserAccountByEmail.mockResolvedValue(account);
    mocks.findUserAccountById.mockResolvedValue(account);
    mocks.findUserAccountForUpdate.mockResolvedValue(account);
    mocks.hashPassword.mockResolvedValue("new-password-hash-sentinel");
    mocks.updateUserAccountPassword.mockResolvedValue(true);
    mocks.verifyPassword.mockResolvedValue(true);
  });

  it("prefers an established database account over environment fallback", async () => {
    await expect(
      authenticateAccountLogin(
        pool,
        account.email,
        "submitted-password-sentinel",
        environment,
        context,
      ),
    ).resolves.toEqual(account);

    expect(mocks.verifyPassword).toHaveBeenCalledWith(
      "submitted-password-sentinel",
      account.passwordHash,
    );
    expect(mocks.verifyAdminCredentials).not.toHaveBeenCalled();
  });

  it("does not write or audit when the current password is invalid", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false);

    await expect(
      changeAccountPassword(
        pool,
        account.id,
        1,
        {
          confirmation: "new-password-sentinel",
          currentPassword: "wrong-password-sentinel",
          newPassword: "new-password-sentinel",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    expect(mocks.updateUserAccountPassword).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("increments credential version without placing passwords or hashes in audit", async () => {
    const changed = await changeAccountPassword(
      pool,
      account.id,
      1,
      {
        confirmation: "new-password-sentinel",
        currentPassword: "old-password-sentinel",
        newPassword: "new-password-sentinel",
      },
      context,
    );

    expect(changed.credentialVersion).toBe(2);
    expect(mocks.updateUserAccountPassword).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        credentialVersion: 2,
        expectedCredentialVersion: 1,
      }),
    );
    const auditPayload = JSON.stringify(mocks.appendAuditEvent.mock.calls);
    expect(auditPayload).not.toContain("old-password-sentinel");
    expect(auditPayload).not.toContain("new-password-sentinel");
    expect(auditPayload).not.toContain("password-hash-sentinel");
  });
});
