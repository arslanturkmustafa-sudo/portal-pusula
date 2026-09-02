import { NextRequest, NextResponse } from "next/server";

import { listFinanceReceivables } from "@/features/finance";
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    const result = await listFinanceReceivables(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
    );
    return json(result);
  } catch {
    return json({ status: "service_unavailable" }, 503);
  }
}
