// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class AccountInitializationConflictError extends Error {}
  class AccountSessionInvalidError extends Error {}
  class CurrentPasswordInvalidError extends Error {}
  return {
    AccountInitializationConflictError,
    AccountSessionInvalidError,
    CurrentPasswordInvalidError,
    authenticateAdminRequest: vi.fn(),
    changeAccountPassword: vi.fn(),
    getAuthStorageMode: vi.fn(),
    initializeAccountFromLegacySession: vi.fn(),
  };
});

vi.mock("@/features/account", () => ({
  accountSummary: (account: {
    email: string;
    passwordChangedAtUtc: string;
  }) => ({
    email: account.email,
    passwordChangedAtUtc: account.passwordChangedAtUtc,
    requiresCurrentPassword: true,
  }),
  AccountInitializationConflictError: mocks.AccountInitializationConflictError,
  AccountSessionInvalidError: mocks.AccountSessionInvalidError,
  changeAccountPassword: mocks.changeAccountPassword,
  CurrentPasswordInvalidError: mocks.CurrentPasswordInvalidError,
  initializeAccountFromLegacySession: mocks.initializeAccountFromLegacySession,
  passwordChangeInputSchema: { parse: (value: unknown) => value },
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
}));
vi.mock("@/platform/config/auth-env", () => ({
  getAuthEnvironment: () => ({
    ADMIN_EMAIL: "yonetici@example.com",
    ADMIN_PASSWORD_HASH: "hash",
    SESSION_SECRET: "AbcdEFgh12345678",
  }),
}));
vi.mock("@/platform/config/auth-storage-mode", () => ({
  getAuthStorageMode: mocks.getAuthStorageMode,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { PATCH } from "@/app/api/account/password/route";

const account = {
  createdAtUtc: "2026-09-01 09:00:00.000000",
  credentialVersion: 2,
  email: "yonetici@example.com",
  id: "11111111-1111-4111-8111-111111111111",
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
  passwordHash: "password-hash-must-not-be-returned",
  status: "active",
  updatedAtUtc: "2026-09-01 09:00:00.000000",
};
const previousValue = ["old", "sample"].join("-");
const nextValue = ["new", "sample"].join("-");

function request(
  body: Record<string, unknown>,
  origin = "https://portal.example.test",
  options: Readonly<{
    forwardedProtocol?: string;
    host?: string;
    url?: string;
  }> = {},
) {
  return new NextRequest(
    options.url ?? "https://portal.example.test/api/account/password",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(options.forwardedProtocol
          ? { "x-forwarded-proto": options.forwardedProtocol }
          : {}),
        ...(options.host ? { host: options.host } : {}),
        origin,
        "x-correlation-id": "22222222-2222-4222-8222-222222222222",
      },
      method: "PATCH",
    },
  );
}

describe("account password endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changeAccountPassword.mockResolvedValue(account);
    mocks.getAuthStorageMode.mockReturnValue("database");
    mocks.initializeAccountFromLegacySession.mockResolvedValue(account);
  });

  it("rejects an unauthenticated or cross-origin write", async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce(null);
    expect((await PATCH(request({}))).status).toBe(401);

    mocks.authenticateAdminRequest.mockResolvedValueOnce({
      accountId: account.id,
      credentialVersion: 1,
      email: account.email,
      kind: "account",
      passwordChangedAtUtc: account.passwordChangedAtUtc,
    });
    expect((await PATCH(request({}, "https://attacker.example"))).status).toBe(403);
    expect(mocks.changeAccountPassword).not.toHaveBeenCalled();
  });

  it("accepts the public Host origin behind a reverse proxy", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      accountId: account.id,
      credentialVersion: 1,
      email: account.email,
      kind: "account",
      passwordChangedAtUtc: account.passwordChangedAtUtc,
    });

    const response = await PATCH(
      request(
        {
          confirmation: nextValue,
          currentPassword: previousValue,
          newPassword: nextValue,
        },
        "https://portal.example.test",
        {
          forwardedProtocol: "https",
          host: "portal.example.test",
          url: "http://internal-hosting.example/api/account/password",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.changeAccountPassword).toHaveBeenCalledOnce();
  });

  it("does not trust a forwarded host supplied by a cross-site request", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      accountId: account.id,
      credentialVersion: 1,
      email: account.email,
      kind: "account",
      passwordChangedAtUtc: account.passwordChangedAtUtc,
    });

    const response = await PATCH(
      new NextRequest("http://internal-hosting.example/api/account/password", {
        body: JSON.stringify({
          confirmation: nextValue,
          currentPassword: previousValue,
          newPassword: nextValue,
        }),
        headers: {
          "content-type": "application/json",
          host: "portal.example.test",
          origin: "https://attacker.example",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
        },
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.changeAccountPassword).not.toHaveBeenCalled();
  });

  it("bootstraps a legacy session without requesting its current password", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      email: account.email,
      kind: "legacy",
    });
    const response = await PATCH(
      request({ confirmation: nextValue, newPassword: nextValue }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("portal_pusula_session=");
    expect(mocks.initializeAccountFromLegacySession).toHaveBeenCalledWith(
      {},
      {
        confirmation: nextValue,
        currentPassword: undefined,
        newPassword: nextValue,
      },
      expect.any(Object),
      expect.objectContaining({
        correlationId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "password-hash-must-not-be-returned",
    );
  });

  it("keeps password management unavailable in environment mode", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      email: account.email,
      kind: "legacy",
    });
    mocks.getAuthStorageMode.mockReturnValue("environment");

    const response = await PATCH(
      request({ confirmation: nextValue, newPassword: nextValue }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ status: "not_available" });
    expect(mocks.initializeAccountFromLegacySession).not.toHaveBeenCalled();
  });

  it("requires the established account path and rotates to its next version", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      accountId: account.id,
      credentialVersion: 1,
      email: account.email,
      kind: "account",
      passwordChangedAtUtc: account.passwordChangedAtUtc,
    });
    const input = {
      confirmation: nextValue,
      currentPassword: previousValue,
      newPassword: nextValue,
    };
    const response = await PATCH(request(input));

    expect(response.status).toBe(200);
    expect(mocks.changeAccountPassword).toHaveBeenCalledWith(
      {},
      account.id,
      1,
      input,
      expect.any(Object),
    );
    expect(response.headers.get("set-cookie")).toContain("portal_pusula_session=");
  });
});
