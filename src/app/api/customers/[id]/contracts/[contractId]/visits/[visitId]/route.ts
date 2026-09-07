import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractClosedError,
  ContractResourceNotFoundError,
  MonthOutsideContractError,
  updateMonthlyVisitWithWorkItems,
  updateVisitWithWorkItemsInputSchema,
  VisitLockedError,
} from "@/features/contracts";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
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
  const principal = await authenticateAdminRequest(request, "visits.write");
  if (!principal) {
    return json({ status: "unauthorized" }, 401);
  }

  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { contractId, id, visitId } = await context.params;
    const input = updateVisitWithWorkItemsInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    if (
      input.workItems.length > 0 &&
      !hasPermission(principal, "tasks.write")
    ) {
      return json({ status: "forbidden" }, 403);
    }
    const result = await updateMonthlyVisitWithWorkItems(
      databasePool(),
      id,
      contractId,
      visitId,
      input,
      {
        actorId: principal.kind === "account" ? principal.accountId : undefined,
        correlationId: correlationIdFromHeaders(request.headers),
      },
    );
    return json({
      createdTaskCount: result.tasks.length,
      visit: result.visit,
    });
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
