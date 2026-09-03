import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createTask,
  createTaskInputSchema,
  listTasks,
  TaskAssigneeNotFoundError,
  TaskCustomerNotFoundError,
  TaskProjectNotFoundError,
} from "@/features/tasks";
import {
  authenticateAdminRequest,
  type AuthenticatedAdmin,
} from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_384;

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

function databasePool() {
  return getPlatformDatabasePool(getDatabaseProbeEnvironment());
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await authenticateAdminRequest(request))) {
    return json({ status: "unauthorized" }, 401);
  }
  if ([...request.nextUrl.searchParams].length > 0) {
    return json({ status: "validation_error" }, 400);
  }

  try {
    return json({ tasks: await listTasks(databasePool()) });
  } catch {
    return json({ status: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401);
  if (!sameOrigin(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createTaskInputSchema.parse(await readBody(request));
    const task = await createTask(databasePool(), input, {
      actorId: actorId(principal),
      correlationId,
    });
    return json({ task }, 201);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof TaskCustomerNotFoundError) {
      return json({ status: "customer_not_found" }, 404);
    }
    if (error instanceof TaskAssigneeNotFoundError) {
      return json({ status: "assignee_not_found" }, 404);
    }
    if (error instanceof TaskProjectNotFoundError) {
      return json({ status: "project_not_found" }, 404);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      {
        event: "task.api.database_failed",
        method: "POST",
        mysqlErrorCode,
        pathname: "/api/tasks",
      },
      `Task API database operation failed: ${mysqlErrorCode}`,
    );
    return json({ status: "service_unavailable" }, 503);
  }
}
