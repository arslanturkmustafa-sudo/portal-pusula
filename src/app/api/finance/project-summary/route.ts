import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getProjectFinanceReport,
  projectFinanceReportFilterSchema,
} from "@/features/finance";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await authenticateAdminRequest(request))) {
    return json({ status: "unauthorized" }, 401);
  }
  try {
    const parameters = [...request.nextUrl.searchParams];
    if (
      parameters.length !== 1 ||
      parameters[0]?.[0] !== "month" ||
      request.nextUrl.searchParams.getAll("month").length !== 1
    ) {
      return json({ status: "validation_error" }, 400);
    }
    const filter = projectFinanceReportFilterSchema.parse({
      month: request.nextUrl.searchParams.get("month"),
    });
    return json(
      await getProjectFinanceReport(
        getPlatformDatabasePool(getDatabaseProbeEnvironment()),
        filter,
      ),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, 400);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
