import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  dailyPlanQuerySchema,
  getDailyAgenda,
} from "@/features/daily-plan";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
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

function databasePool() {
  return getPlatformDatabasePool(getDatabaseProbeEnvironment());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request, "daily-plan.read"))) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    const queryEntries = [...request.nextUrl.searchParams.entries()];
    const queryKeys = queryEntries.map(([key]) => key);
    if (
      queryKeys.filter((key) => key === "date").length !== 1 ||
      queryKeys.filter((key) => key === "view").length > 1 ||
      queryKeys.some((key) => key !== "date" && key !== "view")
    ) {
      return json({ status: "validation_error" }, 400);
    }
    const input = dailyPlanQuerySchema.parse(Object.fromEntries(queryEntries));
    const agenda = await getDailyAgenda(databasePool(), input.date, input.view);
    return json(agenda);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, 400);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
