import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractClosedError,
  ContractResourceNotFoundError,
  MonthOutsideContractError,
  updateMonthlyVisit,
  updateVisitResolutionInputSchema,
  VisitLockedError,
} from "@/features/contracts";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VisitRouteContext = Readonly<{
  params: Promise<{ contractId: string; id: string; visitId: string }>;
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

export async function PATCH(
  request: NextRequest,
  context: VisitRouteContext,
): Promise<NextResponse> {
  if (!isAdminAuthenticated(request)) {
    return json({ status: "unauthorized" }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 16_384) {
    return json({ status: "validation_error" }, 400);
  }

  try {
    const { contractId, id, visitId } = await context.params;
    const input = updateVisitResolutionInputSchema.parse(await request.json());
    const visit = await updateMonthlyVisit(
      databasePool(),
      id,
      contractId,
      visitId,
      input,
      { correlationId: correlationIdFromHeaders(request.headers) },
    );
    return json({ visit });
  } catch (error) {
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
    if (error instanceof VisitLockedError) {
      return json({ status: "visit_locked" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
