import { NextRequest, NextResponse } from "next/server";

import { authenticateAccountLogin } from "@/features/account";
import {
  createAccountSessionToken,
  createSessionToken,
  sessionCookieName,
  sessionCookieOptions,
} from "@/platform/auth/session";
import {
  PasswordVerificationRuntimeError,
  verifyAdminCredentials,
} from "@/platform/auth/password";
import { getAuthEnvironment } from "@/platform/config/auth-env";
import { getAuthStorageMode } from "@/platform/config/auth-storage-mode";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FORM_BYTES = 4_096;

type LoginDiagnosticCategory =
  | "auth_database_unavailable"
  | "auth_env_invalid"
  | "auth_scrypt_runtime_error"
  | "credentials_rejected";

function sameOriginRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    headers: { Location: location },
    status: 303,
  });
}

function failedLogin(
  request: NextRequest,
  category: LoginDiagnosticCategory,
): NextResponse {
  requestLogger(correlationIdFromHeaders(request.headers)).warn(
    {
      category,
      event: "auth.login.failed",
    },
    `Administrator login failed: ${category}`,
  );
  const response = sameOriginRedirect("/giris?hata=1");
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_FORM_BYTES
  ) {
    return failedLogin(request, "credentials_rejected");
  }

  try {
    const formData = await request.formData();
    const email = formData.get("email");
    const password = formData.get("password");
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length < 1 ||
      password.length > 256
    ) {
      return failedLogin(request, "credentials_rejected");
    }

    let environment;
    let storageMode;
    try {
      environment = getAuthEnvironment();
      storageMode = getAuthStorageMode();
    } catch {
      return failedLogin(request, "auth_env_invalid");
    }

    let sessionToken: string;
    try {
      if (storageMode === "environment") {
        if (!(await verifyAdminCredentials(email, password, environment))) {
          return failedLogin(request, "credentials_rejected");
        }
        sessionToken = createSessionToken(environment.SESSION_SECRET);
      } else {
        const account = await authenticateAccountLogin(
          getPlatformDatabasePool(getDatabaseProbeEnvironment()),
          email,
          password,
          environment,
          { correlationId: correlationIdFromHeaders(request.headers) },
        );
        if (!account) return failedLogin(request, "credentials_rejected");
        sessionToken = createAccountSessionToken(
          environment.SESSION_SECRET,
          account.id,
          account.credentialVersion,
        );
      }
    } catch (error) {
      return failedLogin(
        request,
        error instanceof PasswordVerificationRuntimeError
          ? "auth_scrypt_runtime_error"
          : "auth_database_unavailable",
      );
    }
    const production = process.env.NODE_ENV === "production";
    const response = sameOriginRedirect("/musteriler");
    response.cookies.set({
      name: sessionCookieName(production),
      value: sessionToken,
      ...sessionCookieOptions(production),
    });
    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, must-revalidate",
    );
    return response;
  } catch {
    return failedLogin(request, "credentials_rejected");
  }
}
