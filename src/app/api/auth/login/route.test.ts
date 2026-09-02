// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAccountLogin: vi.fn(),
  getAuthEnvironment: vi.fn(),
  getAuthStorageMode: vi.fn(),
  getDatabaseProbeEnvironment: vi.fn(),
  getPlatformDatabasePool: vi.fn(),
  requestLogger: vi.fn(),
  verifyAdminCredentials: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/features/account", () => ({
  authenticateAccountLogin: mocks.authenticateAccountLogin,
}));
vi.mock("@/platform/config/auth-env", () => ({
  getAuthEnvironment: mocks.getAuthEnvironment,
}));
vi.mock("@/platform/config/auth-storage-mode", () => ({
  getAuthStorageMode: mocks.getAuthStorageMode,
}));
vi.mock("@/platform/auth/password", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/auth/password")>()),
  verifyAdminCredentials: mocks.verifyAdminCredentials,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: mocks.getDatabaseProbeEnvironment,
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: mocks.getPlatformDatabasePool,
}));
vi.mock("@/platform/logging/logger", () => ({
  requestLogger: mocks.requestLogger,
}));

import { POST } from "@/app/api/auth/login/route";
import { PasswordVerificationRuntimeError } from "@/platform/auth/password";

const correlationId = "11111111-1111-4111-8111-111111111111";
const environment = {
  ADMIN_EMAIL: "yonetici@example.com",
  ADMIN_PASSWORD_HASH:
    "scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  SESSION_SECRET: "AbcdEFgh12345678",
};

function loginRequest(): NextRequest {
  return new NextRequest("https://portal.example.test/api/auth/login", {
    body: new URLSearchParams({
      email: "yonetici@example.com",
      password: "password-input-sentinel",
    }),
    headers: { "x-correlation-id": correlationId },
    method: "POST",
  });
}

async function expectFailedLogin(
  category:
    | "auth_database_unavailable"
    | "auth_env_invalid"
    | "auth_scrypt_runtime_error"
    | "credentials_rejected",
) {
  const response = await POST(loginRequest());

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/giris?hata=1");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(mocks.requestLogger).toHaveBeenCalledWith(correlationId);
  expect(mocks.warn).toHaveBeenCalledWith(
    { category, event: "auth.login.failed" },
    `Administrator login failed: ${category}`,
  );
  expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
    "password-input-sentinel",
  );
}

describe("administrator login diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAccountLogin.mockResolvedValue(null);
    mocks.getAuthEnvironment.mockReturnValue(environment);
    mocks.getAuthStorageMode.mockReturnValue("database");
    mocks.getDatabaseProbeEnvironment.mockReturnValue({});
    mocks.getPlatformDatabasePool.mockReturnValue({});
    mocks.requestLogger.mockReturnValue({ warn: mocks.warn });
  });

  it("logs an invalid runtime auth environment without exposing credentials", async () => {
    mocks.getAuthEnvironment.mockImplementationOnce(() => {
      throw new Error("environment-value-sentinel");
    });
    await expectFailedLogin("auth_env_invalid");
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      "environment-value-sentinel",
    );
  });

  it("distinguishes an scrypt runtime failure from rejected credentials", async () => {
    mocks.authenticateAccountLogin.mockRejectedValueOnce(
      new PasswordVerificationRuntimeError(),
    );
    await expectFailedLogin("auth_scrypt_runtime_error");
  });

  it("logs rejected credentials without changing the external redirect", async () => {
    await expectFailedLogin("credentials_rejected");
  });

  it("uses explicit environment mode without resolving the database", async () => {
    mocks.getAuthStorageMode.mockReturnValue("environment");
    mocks.verifyAdminCredentials.mockResolvedValue(true);

    const response = await POST(loginRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/musteriler");
    expect(response.headers.get("set-cookie")).toContain("v1.");
    expect(mocks.authenticateAccountLogin).not.toHaveBeenCalled();
    expect(mocks.getDatabaseProbeEnvironment).not.toHaveBeenCalled();
  });

  it("keeps database failures generic externally", async () => {
    mocks.authenticateAccountLogin.mockRejectedValueOnce(
      new Error("database-error-sentinel"),
    );
    await expectFailedLogin("auth_database_unavailable");
    expect(mocks.verifyAdminCredentials).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      "database-error-sentinel",
    );
  });
});
