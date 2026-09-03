import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractNotBillableError,
  FinanceMonthOutsideContractError,
  FinanceContractProjectMissingError,
  FinanceResourceNotFoundError,
  generateContractMonthReceivable,
  generateReceivableInputSchema,
} from "@/features/finance";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }
  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const input = generateReceivableInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    const result = await generateContractMonthReceivable(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      input,
      { correlationId: correlationIdFromHeaders(request.headers) },
    );
    return json(result, result.created ? 201 : 200);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError
    ) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof FinanceResourceNotFoundError) {
      return json({ status: "resource_not_found" }, 404);
    }
    if (error instanceof ContractNotBillableError) {
      return json({ status: "contract_not_billable" }, 409);
    }
    if (error instanceof FinanceContractProjectMissingError) {
      return json({ status: "contract_project_missing" }, 409);
    }
    if (error instanceof FinanceMonthOutsideContractError) {
      return json({ status: "month_outside_contract" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
