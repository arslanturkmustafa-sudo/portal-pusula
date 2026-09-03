import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractClosedError,
  ContractResourceNotFoundError,
  getMonthlyVisitPlan,
  MonthOutsideContractError,
  MonthPlanLockedError,
  monthlyVisitPlanInputSchema,
  replaceMonthlyVisitPlan,
} from "@/features/contracts";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MonthPlanRouteContext = Readonly<{
  params: Promise<{ contractId: string; id: string; month: string }>;
}>;

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

function mappedError(error: unknown): NextResponse | null {
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    error instanceof PlatformInputError
  ) {
    return json({ status: "validation_error" }, 400);
  }
  if (error instanceof ContractResourceNotFoundError) {
    return json({ status: "resource_not_found" }, 404);
  }
  if (error instanceof ContractClosedError) {
    return json({ status: "contract_closed" }, 409);
  }
  if (error instanceof MonthOutsideContractError) {
    return json({ status: "month_outside_contract" }, 409);
  }
  if (error instanceof MonthPlanLockedError) {
    return json({ status: "month_plan_locked" }, 409);
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: MonthPlanRouteContext,
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    const { contractId, id, month } = await context.params;
    const monthPlan = await getMonthlyVisitPlan(
      databasePool(),
      id,
      contractId,
      month,
    );
    return json({ monthPlan });
  } catch (error) {
    return mappedError(error) ?? json({ status: "service_unavailable" }, 503);
  }
}

export async function PUT(
  request: NextRequest,
  context: MonthPlanRouteContext,
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }
  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { contractId, id, month } = await context.params;
    const input = monthlyVisitPlanInputSchema.parse(
      await readJsonWriteBody(request),
    );
    const monthPlan = await replaceMonthlyVisitPlan(
      databasePool(),
      id,
      contractId,
      month,
      input,
      { correlationId: correlationIdFromHeaders(request.headers) },
    );
    return json({ monthPlan });
  } catch (error) {
    return mappedError(error) ?? json({ status: "service_unavailable" }, 503);
  }
}
