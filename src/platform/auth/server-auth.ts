import "server-only";

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { sessionCookieName, verifySessionToken } from "@/platform/auth/session";
import { getAuthEnvironment } from "@/platform/config/auth-env";

export function isDevelopmentAuthenticationBypassed(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.ADMIN_EMAIL &&
    !process.env.ADMIN_PASSWORD_HASH &&
    !process.env.SESSION_SECRET
  );
}

export function isAdminAuthenticated(request: NextRequest): boolean {
  if (isDevelopmentAuthenticationBypassed()) return true;

  try {
    const environment = getAuthEnvironment();
    const token = request.cookies.get(sessionCookieName())?.value ?? "";
    return verifySessionToken(token, environment.SESSION_SECRET);
  } catch {
    return false;
  }
}

export async function isCurrentAdminAuthenticated(): Promise<boolean> {
  if (isDevelopmentAuthenticationBypassed()) return true;

  try {
    const environment = getAuthEnvironment();
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName())?.value ?? "";
    return verifySessionToken(token, environment.SESSION_SECRET);
  } catch {
    return false;
  }
}
