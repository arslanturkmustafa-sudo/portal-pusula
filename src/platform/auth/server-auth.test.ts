// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  canUseLegacySession: vi.fn(),
  getAuthStorageMode: vi.fn(),
  validateAccountPrincipalSession: vi.fn(),
}));

vi.mock("@/features/account", () => ({
  canUseLegacySession: mocks.canUseLegacySession,
  validateAccountPrincipalSession: mocks.validateAccountPrincipalSession,
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

import {
  authenticateAdminRequest,
  authenticatePrincipalRequest,
} from "@/platform/auth/server-auth";
import {
  createAccountSessionToken,
  createSessionToken,
  sessionCookieName,
} from "@/platform/auth/session";

const secret = "AbcdEFgh12345678";
const accountId = "11111111-1111-4111-8111-111111111111";

function request(token: string): NextRequest {
  return new NextRequest("https://portal.example.test/api/customers", {
    headers: { cookie: `${sessionCookieName(false)}=${token}` },
  });
}

describe("secure administrator authentication", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", "yonetici@example.com");
    vi.stubEnv("ADMIN_PASSWORD_HASH", "configured");
    vi.stubEnv("SESSION_SECRET", secret);
    mocks.validateAccountPrincipalSession.mockResolvedValue({
      account: {
        credentialVersion: 2,
        displayName: "Portal Yöneticisi",
        email: "yonetici@example.com",
        id: accountId,
        passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
        role: "owner",
        status: "active",
      },
      permissions: [],
    });
    mocks.getAuthStorageMode.mockReturnValue("database");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("accepts v2 only after the database credential version is validated", async () => {
    const token = createAccountSessionToken(secret, accountId, 2);

    await expect(authenticateAdminRequest(request(token))).resolves.toMatchObject({
      accountId,
      credentialVersion: 2,
      kind: "account",
    });
    expect(mocks.validateAccountPrincipalSession).toHaveBeenCalledWith({}, accountId, 2);
  });

  it("rejects v1 as soon as a database account exists", async () => {
    mocks.canUseLegacySession.mockResolvedValue(false);

    await expect(
      authenticateAdminRequest(request(createSessionToken(secret))),
    ).resolves.toBeNull();
  });

  it("accepts a member principal only for an explicitly granted module", async () => {
    mocks.validateAccountPrincipalSession.mockResolvedValueOnce({
      account: {
        credentialVersion: 2,
        displayName: "Ayşe Yılmaz",
        email: "ayse@example.com",
        id: accountId,
        passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
        role: "member",
        status: "active",
      },
      permissions: ["tasks.read"],
    });
    const memberRequest = request(createAccountSessionToken(secret, accountId, 2));

    await expect(authenticatePrincipalRequest(memberRequest)).resolves.toMatchObject({
      role: "member",
    });
    mocks.validateAccountPrincipalSession.mockResolvedValueOnce({
      account: {
        credentialVersion: 2,
        displayName: "Ayşe Yılmaz",
        email: "ayse@example.com",
        id: accountId,
        passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
        role: "member",
        status: "active",
      },
      permissions: ["tasks.read"],
    });
    await expect(
      authenticateAdminRequest(memberRequest, "tasks.read"),
    ).resolves.toMatchObject({ role: "member" });
    mocks.validateAccountPrincipalSession.mockResolvedValueOnce({
      account: {
        credentialVersion: 2,
        displayName: "Ayşe Yılmaz",
        email: "ayse@example.com",
        id: accountId,
        passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
        role: "member",
        status: "active",
      },
      permissions: ["tasks.read"],
    });
    await expect(
      authenticateAdminRequest(memberRequest, "finance.receivables.read"),
    ).resolves.toBeNull();
  });

  it("accepts only v1 without database access in explicit environment mode", async () => {
    mocks.getAuthStorageMode.mockReturnValue("environment");

    await expect(
      authenticateAdminRequest(request(createSessionToken(secret))),
    ).resolves.toMatchObject({
      email: "yonetici@example.com",
      kind: "legacy",
      role: "owner",
    });
    await expect(
      authenticateAdminRequest(request(createAccountSessionToken(secret, accountId, 2))),
    ).resolves.toBeNull();
    expect(mocks.canUseLegacySession).not.toHaveBeenCalled();
    expect(mocks.validateAccountPrincipalSession).not.toHaveBeenCalled();
  });
});
