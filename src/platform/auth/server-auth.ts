import "server-only";

import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

import {
  canUseLegacySession,
  validateAccountPrincipalSession,
} from "@/features/account";
import { developmentAuthenticationBypassAllowed } from "@/platform/auth/development-bypass";
import {
  hasPermission,
  PERMISSION_CODES,
  type PermissionCode,
} from "@/platform/auth/permissions";
import {
  parseSessionToken,
  sessionCookieName,
} from "@/platform/auth/session";
import { getAuthEnvironment } from "@/platform/config/auth-env";
import { getAuthStorageMode } from "@/platform/config/auth-storage-mode";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

type OwnerPrincipal = Readonly<{
  displayName: string;
  email: string;
  permissions: readonly PermissionCode[];
  role: "owner";
}>;

export type AuthenticatedPrincipal =
  | (OwnerPrincipal & Readonly<{ kind: "development" }>)
  | (OwnerPrincipal & Readonly<{ kind: "legacy" }>)
  | Readonly<{
      accountId: string;
      credentialVersion: number;
      displayName: string;
      email: string;
      kind: "account";
      passwordChangedAtUtc: string;
      permissions: readonly PermissionCode[];
      role: "member" | "owner";
    }>;

/** @deprecated Use AuthenticatedPrincipal for new authorization code. */
export type AuthenticatedAdmin = AuthenticatedPrincipal;

function hostnameFromHostHeader(host: string | null): string {
  if (!host) return "";
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

export function isDevelopmentAuthenticationBypassed(hostname: string): boolean {
  return developmentAuthenticationBypassAllowed(hostname);
}

function ownerPrincipal(
  kind: "development" | "legacy",
  email: string,
): AuthenticatedPrincipal {
  return {
    displayName: kind === "development" ? "Yerel geliştirici" : "Portal Yöneticisi",
    email,
    kind,
    permissions: PERMISSION_CODES,
    role: "owner",
  };
}

async function authenticateToken(
  token: string,
  hostname: string,
): Promise<AuthenticatedPrincipal | null> {
  if (developmentAuthenticationBypassAllowed(hostname)) {
    return ownerPrincipal("development", "development@localhost");
  }

  try {
    const environment = getAuthEnvironment();
    const storageMode = getAuthStorageMode();
    const session = parseSessionToken(token, environment.SESSION_SECRET);
    if (!session) return null;

    if (session.kind === "legacy") {
      if (storageMode === "environment") {
        return ownerPrincipal("legacy", environment.ADMIN_EMAIL);
      }
      const pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
      return (await canUseLegacySession(pool))
        ? ownerPrincipal("legacy", environment.ADMIN_EMAIL)
        : null;
    }

    if (storageMode === "environment") return null;
    const pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
    const access = await validateAccountPrincipalSession(
      pool,
      session.accountId,
      session.credentialVersion,
    );
    return access
      ? {
          accountId: access.account.id,
          credentialVersion: access.account.credentialVersion,
          displayName: access.account.displayName,
          email: access.account.email,
          kind: "account",
          passwordChangedAtUtc: access.account.passwordChangedAtUtc,
          permissions: access.permissions,
          role: access.account.role,
        }
      : null;
  } catch {
    return null;
  }
}

export function authenticatePrincipalRequest(
  request: NextRequest,
): Promise<AuthenticatedPrincipal | null> {
  return authenticateToken(
    request.cookies.get(sessionCookieName())?.value ?? "",
    request.nextUrl.hostname,
  );
}

export function authenticateAdminRequest(
  request: NextRequest,
): Promise<AuthenticatedAdmin | null>;
export function authenticateAdminRequest(
  request: NextRequest,
  permission: PermissionCode,
): Promise<AuthenticatedPrincipal | null>;
export async function authenticateAdminRequest(
  request: NextRequest,
  permission?: PermissionCode,
): Promise<AuthenticatedPrincipal | null> {
  const principal = await authenticatePrincipalRequest(request);
  if (permission) {
    return principal && hasPermission(principal, permission) ? principal : null;
  }
  return principal?.role === "owner" ? principal : null;
}

export async function isAdminAuthenticated(
  request: NextRequest,
  permission?: PermissionCode,
): Promise<boolean> {
  return permission
    ? (await authenticateAdminRequest(request, permission)) !== null
    : (await authenticateAdminRequest(request)) !== null;
}

export async function authenticateCurrentPrincipal(): Promise<AuthenticatedPrincipal | null> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return authenticateToken(
    cookieStore.get(sessionCookieName())?.value ?? "",
    hostnameFromHostHeader(headerStore.get("host")),
  );
}

export async function authenticateCurrentAdmin(): Promise<AuthenticatedAdmin | null> {
  const principal = await authenticateCurrentPrincipal();
  return principal?.role === "owner" ? principal : null;
}

export async function isCurrentAdminAuthenticated(): Promise<boolean> {
  return (await authenticateCurrentAdmin()) !== null;
}
