import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractPeriodConflictError,
  ContractProjectLockedError,
  ContractProjectUnavailableError,
  ContractResourceNotFoundError,
  ContractVisitRangeConflictError,
  updateContractInputSchema,
  updateCustomerContract,
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

type ContractDetailRouteContext = Readonly<{
  params: Promise<{ contractId: string; id: string }>;
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
  context: ContractDetailRouteContext,
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { contractId, id } = await context.params;
    const input = updateContractInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    const contract = await updateCustomerContract(
      databasePool(),
      id,
      contractId,
      input,
      { correlationId: correlationIdFromHeaders(request.headers) },
    );
    return json({ contract });
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
    if (error instanceof ContractPeriodConflictError) {
      return json({ status: "contract_period_conflict" }, 409);
    }
    if (error instanceof ContractVisitRangeConflictError) {
      return json({ status: "contract_visit_range_conflict" }, 409);
    }
    if (error instanceof ContractProjectUnavailableError) {
      return json({ status: "project_unavailable" }, 409);
    }
    if (error instanceof ContractProjectLockedError) {
      return json({ status: "contract_project_locked" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
