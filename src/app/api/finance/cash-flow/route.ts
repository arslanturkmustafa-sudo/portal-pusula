import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { cashFlowFilterSchema, getCashFlowReport } from "@/features/finance";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { hasPermission } from "@/platform/auth/permissions";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import {
  CORRELATION_ID_HEADER,
  correlationIdFromHeaders,
} from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status: number, correlationId: string): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(request.headers);
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401, correlationId);
  if (!hasPermission(principal, "finance.reports.read")) {
    return json({ status: "forbidden" }, 403, correlationId);
  }

  try {
    const parameters = [...request.nextUrl.searchParams];
    const expectedParameters = ["from", "granularity", "to"] as const;
    if (
      parameters.length !== expectedParameters.length ||
      parameters.some(([name]) =>
        !expectedParameters.includes(name as (typeof expectedParameters)[number])
      ) ||
      expectedParameters.some(
        (name) => request.nextUrl.searchParams.getAll(name).length !== 1,
      )
    ) {
      return json({ status: "validation_error" }, 400, correlationId);
    }
    const filter = cashFlowFilterSchema.parse({
      from: request.nextUrl.searchParams.get("from"),
      granularity: request.nextUrl.searchParams.get("granularity"),
      to: request.nextUrl.searchParams.get("to"),
    });
    return json(
      await getCashFlowReport(
        getPlatformDatabasePool(getDatabaseProbeEnvironment()),
        filter,
      ),
      200,
      correlationId,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, 400, correlationId);
    }
    requestLogger(correlationId).error("Cash flow report request failed.");
    return json({ status: "service_unavailable" }, 503, correlationId);
  }
}
