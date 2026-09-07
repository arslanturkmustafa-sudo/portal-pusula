import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildDailyAgendaIcs,
  buildDailyAgendaPrintHtml,
  scopeDailyAgendaForCustomerExport,
} from "@/features/daily-plan/calendar-export";
import {
  dailyPlanExportQuerySchema,
  getDailyAgenda,
} from "@/features/daily-plan";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function responseHeaders(correlationId: string): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Correlation-ID": correlationId,
  });
}

function json(body: unknown, correlationId: string, status: number): NextResponse {
  return NextResponse.json(body, {
    headers: responseHeaders(correlationId),
    status,
  });
}

function hasExactQueryShape(entries: readonly (readonly [string, string])[]): boolean {
  const keys = entries.map(([key]) => key);
  return (
    keys.filter((key) => key === "customerId").length === 1 &&
    keys.filter((key) => key === "date").length === 1 &&
    keys.filter((key) => key === "format").length === 1 &&
    keys.filter((key) => key === "location").length <= 1 &&
    keys.filter((key) => key === "view").length <= 1 &&
    keys.every((key) =>
      key === "customerId" ||
      key === "date" ||
      key === "format" ||
      key === "location" ||
      key === "view",
    )
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(request.headers);
  const principal = await authenticateAdminRequest(request, "daily-plan.read");
  if (!principal) return json({ status: "unauthorized" }, correlationId, 401);

  try {
    const entries = [...request.nextUrl.searchParams.entries()];
    if (!hasExactQueryShape(entries)) {
      return json({ status: "validation_error" }, correlationId, 400);
    }
    const input = dailyPlanExportQuerySchema.parse(Object.fromEntries(entries));
    const agenda = scopeDailyAgendaForCustomerExport(
      await getDailyAgenda(
        getPlatformDatabasePool(getDatabaseProbeEnvironment()),
        input.date,
        input.view,
        false,
        input.customerId,
      ),
      input.customerId,
      input.location,
    );
    const headers = responseHeaders(correlationId);
    if (input.format === "ics") {
      headers.set("Content-Type", "text/calendar; charset=utf-8");
      headers.set(
        "Content-Disposition",
        'attachment; filename="portal-pusula-musteri-takvimi.ics"',
      );
      return new NextResponse(buildDailyAgendaIcs(agenda, input.customerId), {
        headers,
        status: 200,
      });
    }

    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    headers.set("Referrer-Policy", "no-referrer");
    return new NextResponse(
      buildDailyAgendaPrintHtml(agenda, input.customerId),
      { headers, status: 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ status: "validation_error" }, correlationId, 400);
    }
    requestLogger(correlationId).error(
      {
        event: "daily_plan.export_failed",
        pathname: "/api/daily-plan/export",
      },
      "Daily plan export failed.",
    );
    return json({ status: "service_unavailable" }, correlationId, 503);
  }
}
