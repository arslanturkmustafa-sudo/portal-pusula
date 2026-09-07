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
import { runLoginAttemptWithThrottle } from "@/platform/auth/login-throttle";
import { getAuthEnvironment } from "@/platform/config/auth-env";
import { getAuthStorageMode } from "@/platform/config/auth-storage-mode";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isSameOriginWriteRequest,
  readBoundedRequestText,
} from "@/platform/http/write-request";
import { requestLogger } from "@/platform/logging/logger";
import { safePortalReturnPath } from "@/platform/navigation/portal-return-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FORM_BYTES = 4_096;

type LoginDiagnosticCategory =
  | "auth_database_unavailable"
  | "auth_env_invalid"
  | "auth_scrypt_runtime_error"
  | "credentials_rejected"
  | "login_throttled"
  | "request_body_rejected"
  | "request_content_type_rejected"
  | "request_origin_rejected";

function sameOriginRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    headers: { Location: location },
    status: 303,
  });
}

function failedLogin(
  request: NextRequest,
  category: LoginDiagnosticCategory,
  returnPath = "/",
): NextResponse {
  requestLogger(correlationIdFromHeaders(request.headers)).warn(
    {
      category,
      event: "auth.login.failed",
    },
    `Administrator login failed: ${category}`,
  );
  const safeReturnPath = safePortalReturnPath(returnPath);
  const search = new URLSearchParams({ hata: "1" });
  if (safeReturnPath !== "/") search.set("next", safeReturnPath);
  const response = sameOriginRedirect(`/giris?${search.toString()}`);
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginWriteRequest(request)) {
    return failedLogin(request, "request_origin_rejected");
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  ) {
    return failedLogin(request, "request_content_type_rejected");
  }

  try {
    const body = await readBoundedRequestText(request, MAX_FORM_BYTES);
    const formData = new URLSearchParams(body);
    if (
      [...formData.keys()].some(
        (key) => key !== "email" && key !== "next" && key !== "password",
      ) ||
      formData.getAll("email").length !== 1 ||
      formData.getAll("password").length !== 1 ||
      formData.getAll("next").length > 1
    ) {
      return failedLogin(request, "request_body_rejected");
    }
    const email = formData.get("email");
    const password = formData.get("password");
    const returnPath = safePortalReturnPath(formData.get("next"));
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length < 1 ||
      password.length > 256
    ) {
      return failedLogin(request, "credentials_rejected", returnPath);
    }

    let environment;
    let storageMode;
    try {
      environment = getAuthEnvironment();
      storageMode = getAuthStorageMode();
    } catch {
      return failedLogin(request, "auth_env_invalid", returnPath);
    }

    let sessionToken: string;
    try {
      if (storageMode === "environment") {
        if (!(await verifyAdminCredentials(email, password, environment))) {
          return failedLogin(request, "credentials_rejected", returnPath);
        }
        sessionToken = createSessionToken(environment.SESSION_SECRET);
      } else {
        const pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
        const attempt = await runLoginAttemptWithThrottle(pool, {
          email,
          sessionSecret: environment.SESSION_SECRET,
          verify: () =>
            authenticateAccountLogin(pool, email, password, environment, {
              correlationId: correlationIdFromHeaders(request.headers),
            }),
        });
        if (attempt.status === "blocked") {
          return failedLogin(request, "login_throttled", returnPath);
        }
        if (attempt.status === "rejected") {
          return failedLogin(request, "credentials_rejected", returnPath);
        }
        const account = attempt.value;
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
        returnPath,
      );
    }
    const production = process.env.NODE_ENV === "production";
    const response = sameOriginRedirect(returnPath);
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
    return failedLogin(request, "request_body_rejected");
  }
}
