import { type NextRequest, NextResponse } from "next/server";

import { sessionCookieName, verifySessionToken } from "@/platform/auth/session";
import { parseAuthEnvironment } from "@/platform/config/auth-env.schema";
import {
  CORRELATION_ID_HEADER,
  createCorrelationId,
} from "@/platform/http/correlation-id";

const PUBLIC_PATHS = new Set([
  "/giris",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health/live",
  "/api/internal/readiness",
  "/api/internal/cron/dispatch",
  "/manifest.webmanifest",
]);

function developmentAuthenticationBypass(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.ADMIN_EMAIL &&
    !process.env.ADMIN_PASSWORD_HASH &&
    !process.env.SESSION_SECRET
  );
}

function hasValidAdminSession(request: NextRequest): boolean {
  if (developmentAuthenticationBypass()) return true;

  try {
    const environment = parseAuthEnvironment({
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
      SESSION_SECRET: process.env.SESSION_SECRET,
    });
    const token =
      request.cookies.get(
        sessionCookieName(process.env.NODE_ENV === "production"),
      )?.value ?? "";
    return verifySessionToken(token, environment.SESSION_SECRET);
  } catch {
    return false;
  }
}

function finalizeResponse(
  response: NextResponse,
  correlationId: string,
): NextResponse {
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export function proxy(request: NextRequest) {
  const correlationId = createCorrelationId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_ID_HEADER, correlationId);

  if (
    !PUBLIC_PATHS.has(request.nextUrl.pathname) &&
    !hasValidAdminSession(request)
  ) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return finalizeResponse(
        NextResponse.json({ status: "unauthorized" }, { status: 401 }),
        correlationId,
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/giris";
    loginUrl.search = "";
    loginUrl.hash = "";
    return finalizeResponse(
      NextResponse.redirect(loginUrl),
      correlationId,
    );
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  return finalizeResponse(response, correlationId);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|offline-v1.html|sw.js).*)",
  ],
};
