import { NextRequest, NextResponse } from "next/server";

import {
  AuditHistoryForbiddenError,
  getAuditHistory,
  isAuditEntityType,
} from "@/features/audit-history";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import {
  CORRELATION_ID_HEADER,
  correlationIdFromHeaders,
} from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status: number, correlationId: string): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function exactFilter(request: NextRequest): Readonly<{
  entityId: string;
  entityType: string;
}> | null {
  const allowed = new Set(["entityId", "entityType"]);
  for (const key of request.nextUrl.searchParams.keys()) {
    if (
      !allowed.has(key) ||
      request.nextUrl.searchParams.getAll(key).length !== 1
    ) {
      return null;
    }
  }
  const entityId = request.nextUrl.searchParams.get("entityId");
  const entityType = request.nextUrl.searchParams.get("entityType");
  return entityId && entityType ? { entityId, entityType } : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(request.headers);
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401, correlationId);

  const filter = exactFilter(request);
  if (!filter || !isAuditEntityType(filter.entityType)) {
    return json({ status: "validation_error" }, 400, correlationId);
  }

  try {
    const events = await getAuditHistory(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      filter.entityType,
      filter.entityId,
      principal,
    );
    return json({ events }, 200, correlationId);
  } catch (error) {
    if (error instanceof AuditHistoryForbiddenError) {
      return json({ status: "forbidden" }, 403, correlationId);
    }
    if (error instanceof PlatformInputError) {
      return json({ status: "validation_error" }, 400, correlationId);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "audit_history.api.failed", mysqlErrorCode },
      `Audit history API failed: ${mysqlErrorCode}`,
    );
    return json({ status: "service_unavailable" }, 503, correlationId);
  }
}
