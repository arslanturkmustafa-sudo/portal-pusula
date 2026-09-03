import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ProjectNotFoundError,
  ProjectShortCodeConflictError,
  ProjectVersionConflictError,
  updateProject,
  updateProjectInputSchema,
} from "@/features/projects";
import {
  authenticateAdminRequest,
  type AuthenticatedAdmin,
} from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32_768;

type ProjectRouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

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

function actorId(principal: AuthenticatedAdmin): string | undefined {
  return principal.kind === "account" ? principal.accountId : undefined;
}

export async function PATCH(
  request: NextRequest,
  context: ProjectRouteContext,
): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401);
  if (!sameOrigin(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const { id } = await context.params;
    const input = updateProjectInputSchema.parse(await readBody(request));
    const project = await updateProject(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      id,
      input,
      { actorId: actorId(principal), correlationId },
    );
    return json({ project });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof PlatformInputError
    ) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof ProjectNotFoundError) {
      return json({ status: "project_not_found" }, 404);
    }
    if (error instanceof ProjectShortCodeConflictError) {
      return json({ status: "short_code_conflict" }, 409);
    }
    if (error instanceof ProjectVersionConflictError) {
      return json({ status: "version_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      {
        event: "project.api.database_failed",
        method: "PATCH",
        mysqlErrorCode,
        pathname: "/api/projects/[id]",
      },
      `Project API database operation failed: ${mysqlErrorCode}`,
    );
    return json({ status: "service_unavailable" }, 503);
  }
}
