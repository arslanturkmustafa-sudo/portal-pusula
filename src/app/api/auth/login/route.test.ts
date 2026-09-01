// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthEnvironment: vi.fn(),
  requestLogger: vi.fn(),
  verifyAdminCredentials: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/platform/auth/password", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/platform/auth/password")>();
  return {
    ...original,
    verifyAdminCredentials: mocks.verifyAdminCredentials,
  };
});

vi.mock("@/platform/config/auth-env", () => ({
  getAuthEnvironment: mocks.getAuthEnvironment,
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
    headers: {
      "x-correlation-id": correlationId,
    },
    method: "POST",
  });
}

async function expectFailedLogin(
  category:
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
    {
      category,
      event: "auth.login.failed",
    },
    `Administrator login failed: ${category}`,
  );
  expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
    "password-input-sentinel",
  );
}

describe("administrator login diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthEnvironment.mockReturnValue(environment);
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
    mocks.verifyAdminCredentials.mockRejectedValueOnce(
      new PasswordVerificationRuntimeError(),
    );

    await expectFailedLogin("auth_scrypt_runtime_error");
  });

  it("logs rejected credentials without changing the external redirect", async () => {
    mocks.verifyAdminCredentials.mockResolvedValueOnce(false);

    await expectFailedLogin("credentials_rejected");
  });
});
