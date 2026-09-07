import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getCustomerTaskReport,
  TaskReportCustomerNotFoundError,
  taskReportFilterSchema,
  TaskReportTooLargeError,
} from "@/features/task-reports";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import {
  CORRELATION_ID_HEADER,
  correlationIdFromHeaders,
} from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_FILTERS = new Set(["customerId", "from", "status", "to"]);

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

function strictFilter(request: NextRequest) {
  for (const key of request.nextUrl.searchParams.keys()) {
    if (
      !ALLOWED_FILTERS.has(key) ||
      request.nextUrl.searchParams.getAll(key).length !== 1
    ) {
      throw new z.ZodError([]);
    }
  }
  return taskReportFilterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(request.headers);
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401, correlationId);
  if (!hasPermission(principal, "tasks.reports.export")) {
    return json({ status: "forbidden" }, 403, correlationId);
  }

  try {
    const report = await getCustomerTaskReport(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      strictFilter(request),
    );
    return json({ report }, 200, correlationId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, 400, correlationId);
    }
    if (error instanceof TaskReportCustomerNotFoundError) {
      return json({ status: "not_found" }, 404, correlationId);
    }
    if (error instanceof TaskReportTooLargeError) {
      return json({ status: "report_too_large" }, 422, correlationId);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "task_report.api.failed", mysqlErrorCode },
      `Task report API failed: ${mysqlErrorCode}`,
    );
    return json({ status: "service_unavailable" }, 503, correlationId);
  }
}
