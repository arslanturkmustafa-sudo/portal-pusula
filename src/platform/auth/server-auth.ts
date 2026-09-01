import "server-only";

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import {
  canUseLegacySession,
  validateAccountSession,
} from "@/features/account";
import {
  parseSessionToken,
  sessionCookieName,
} from "@/platform/auth/session";
import { getAuthEnvironment } from "@/platform/config/auth-env";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

export type AuthenticatedAdmin =
  | Readonly<{ kind: "development" }>
  | Readonly<{ email: string; kind: "legacy" }>
  | Readonly<{
      accountId: string;
      credentialVersion: number;
      email: string;
      kind: "account";
      passwordChangedAtUtc: string;
    }>;

export function isDevelopmentAuthenticationBypassed(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.ADMIN_EMAIL &&
    !process.env.ADMIN_PASSWORD_HASH &&
    !process.env.SESSION_SECRET
  );
}

async function authenticateToken(token: string): Promise<AuthenticatedAdmin | null> {
  if (isDevelopmentAuthenticationBypassed()) return { kind: "development" };

  try {
    const environment = getAuthEnvironment();
    const session = parseSessionToken(token, environment.SESSION_SECRET);
    if (!session) return null;

    const pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
    if (session.kind === "legacy") {
      return (await canUseLegacySession(pool))
        ? { email: environment.ADMIN_EMAIL, kind: "legacy" }
        : null;
    }

    const account = await validateAccountSession(
      pool,
      session.accountId,
      session.credentialVersion,
    );
    return account
      ? {
          accountId: account.id,
          credentialVersion: account.credentialVersion,
          email: account.email,
          kind: "account",
          passwordChangedAtUtc: account.passwordChangedAtUtc,
        }
      : null;
  } catch {
    return null;
  }
}

export function authenticateAdminRequest(
  request: NextRequest,
): Promise<AuthenticatedAdmin | null> {
  return authenticateToken(
    request.cookies.get(sessionCookieName())?.value ?? "",
  );
}

export async function isAdminAuthenticated(
  request: NextRequest,
): Promise<boolean> {
  return (await authenticateAdminRequest(request)) !== null;
}

export async function authenticateCurrentAdmin(): Promise<AuthenticatedAdmin | null> {
  const cookieStore = await cookies();
  return authenticateToken(cookieStore.get(sessionCookieName())?.value ?? "");
}

export async function isCurrentAdminAuthenticated(): Promise<boolean> {
  return (await authenticateCurrentAdmin()) !== null;
}
