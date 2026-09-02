import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractNotBillableError,
  FinanceMonthOutsideContractError,
  FinanceResourceNotFoundError,
  generateContractMonthReceivable,
  generateReceivableInputSchema,
} from "@/features/finance";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";

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

function invalidBody(request: NextRequest): boolean {
  const length = Number(request.headers.get("content-length") ?? "0");
  return !Number.isFinite(length) || length > 16_384;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }
  if (invalidBody(request)) return json({ status: "validation_error" }, 400);

  try {
    const input = generateReceivableInputSchema.parse(await request.json());
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
    if (error instanceof FinanceMonthOutsideContractError) {
      return json({ status: "month_outside_contract" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
