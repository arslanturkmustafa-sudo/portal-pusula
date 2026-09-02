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
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    const queryEntries = [...request.nextUrl.searchParams.entries()];
    if (queryEntries.length !== 1 || queryEntries[0]?.[0] !== "date") {
      return json({ status: "validation_error" }, 400);
    }
    const input = dailyPlanQuerySchema.parse(Object.fromEntries(queryEntries));
    const agenda = await getDailyAgenda(databasePool(), input.date);
    return json(agenda);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, 400);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
