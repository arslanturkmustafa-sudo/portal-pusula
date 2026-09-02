import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  accountSummary,
  AccountInitializationConflictError,
  AccountSessionInvalidError,
  changeAccountPassword,
  CurrentPasswordInvalidError,
  initializeAccountFromLegacySession,
  passwordChangeInputSchema,
} from "@/features/account";
import { PasswordVerificationRuntimeError } from "@/platform/auth/password";
import {
  createAccountSessionToken,
  sessionCookieName,
  sessionCookieOptions,
} from "@/platform/auth/session";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { getAuthEnvironment } from "@/platform/config/auth-env";
import { getAuthStorageMode } from "@/platform/config/auth-storage-mode";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

function sameOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  try {
    if (originHeader === null) return false;

    const origin = new URL(originHeader);
    const requestUrl = new URL(request.url);
    if (origin.origin === requestUrl.origin) return true;

    // Reverse proxies can expose their internal application hostname through
    // request.url while preserving the browser-facing hostname in Host. Host
    // is a forbidden browser request header, so matching it keeps the CSRF
    // boundary intact without tying the route to Hostinger's internal URL.
    const host = request.headers.get("host")?.trim().toLowerCase();
    if (!host || origin.host !== host) return false;

    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase();
    const acceptedProtocols = new Set([requestUrl.protocol]);
    if (forwardedProtocol === "http" || forwardedProtocol === "https") {
      acceptedProtocols.add(`${forwardedProtocol}:`);
    }

    return acceptedProtocols.has(origin.protocol);
  } catch {
    return false;
  }
}

function isJsonRequest(request: NextRequest): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

async function readBody(request: NextRequest): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_BODY_BYTES
  ) {
    throw new z.ZodError([]);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new z.ZodError([]);
  }
  return JSON.parse(text) as unknown;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401);
  if (!sameOrigin(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }
  if (principal.kind === "development") {
    return json({ status: "not_available" }, 409);
  }
  if (getAuthStorageMode() === "environment") {
    return json({ status: "not_available" }, 409);
  }

  try {
    const input = passwordChangeInputSchema.parse(await readBody(request));
    const environment = getAuthEnvironment();
    const pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
    const context = {
      correlationId: correlationIdFromHeaders(request.headers),
    };
    const account =
      principal.kind === "legacy"
        ? await initializeAccountFromLegacySession(
            pool,
            { ...input, currentPassword: undefined },
            environment,
            context,
          )
        : await changeAccountPassword(
            pool,
            principal.accountId,
            principal.credentialVersion,
            input,
            context,
          );

    const production = process.env.NODE_ENV === "production";
    const response = json({
      account: accountSummary(account),
      status: "ok",
    });
    response.cookies.set({
      name: sessionCookieName(production),
      value: createAccountSessionToken(
        environment.SESSION_SECRET,
        account.id,
        account.credentialVersion,
      ),
      ...sessionCookieOptions(production),
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof CurrentPasswordInvalidError) {
      return json({ status: "current_password_invalid" }, 400);
    }
    if (error instanceof AccountInitializationConflictError) {
      return json({ status: "account_already_initialized" }, 409);
    }
    if (error instanceof AccountSessionInvalidError) {
      return json({ status: "unauthorized" }, 401);
    }
    if (error instanceof PasswordVerificationRuntimeError) {
      return json({ status: "service_unavailable" }, 503);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
