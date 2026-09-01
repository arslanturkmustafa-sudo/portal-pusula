// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  canUseLegacySession: vi.fn(),
  validateAccountSession: vi.fn(),
}));

vi.mock("@/features/account", () => ({
  canUseLegacySession: mocks.canUseLegacySession,
  validateAccountSession: mocks.validateAccountSession,
}));
vi.mock("@/platform/config/auth-env", () => ({
  getAuthEnvironment: () => ({
    ADMIN_EMAIL: "yonetici@example.com",
    ADMIN_PASSWORD_HASH: "hash",
    SESSION_SECRET: "AbcdEFgh12345678",
  }),
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { authenticateAdminRequest } from "@/platform/auth/server-auth";
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
    mocks.validateAccountSession.mockResolvedValue({
      credentialVersion: 2,
      email: "yonetici@example.com",
      id: accountId,
      passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
      status: "active",
    });
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
    expect(mocks.validateAccountSession).toHaveBeenCalledWith({}, accountId, 2);
  });

  it("rejects v1 as soon as a database account exists", async () => {
    mocks.canUseLegacySession.mockResolvedValue(false);

    await expect(
      authenticateAdminRequest(request(createSessionToken(secret))),
    ).resolves.toBeNull();
  });
});
