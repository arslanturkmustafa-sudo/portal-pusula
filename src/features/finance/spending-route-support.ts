import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import type { AuthenticatedAdmin } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

const MAX_BODY_BYTES = 32_768;

export function spendingJson(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export function spendingDatabasePool() {
  return getPlatformDatabasePool(getDatabaseProbeEnvironment());
}

export function spendingActorId(
  principal: AuthenticatedAdmin,
): string | undefined {
  return principal.kind === "account" ? principal.accountId : undefined;
}

export function isSameOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  try {
    if (originHeader === null) return false;
    const origin = new URL(originHeader);
    const requestUrl = new URL(request.url);
    if (origin.origin === requestUrl.origin) return true;
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

export function isJsonRequest(request: NextRequest): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

export async function readSpendingBody(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  ) {
    throw new z.ZodError([]);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new z.ZodError([]);
  }
  return JSON.parse(text) as unknown;
}

export function uniqueQuery(
  request: NextRequest,
  allowedKeys: ReadonlySet<string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!allowedKeys.has(key) || Object.hasOwn(values, key)) {
      throw new z.ZodError([]);
    }
    values[key] = value;
  }
  return values;
}
