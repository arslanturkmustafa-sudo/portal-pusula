import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  financeReceivableListFilterSchema,
  listFinanceReceivables,
} from "@/features/finance";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS = new Set(["projectId"]);

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    for (const key of request.nextUrl.searchParams.keys()) {
      if (
        !FILTERS.has(key) ||
        request.nextUrl.searchParams.getAll(key).length !== 1
      ) {
        return json({ status: "validation_error" }, 400);
      }
    }
    const filters = financeReceivableListFilterSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const result = await listFinanceReceivables(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      filters,
    );
    return json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, 400);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
