import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CustomerNotFoundError,
  CustomerShortCodeConflictError,
  updateCustomer,
  updateCustomerInputSchema,
} from "@/features/customers";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CustomerRouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function PATCH(
  request: NextRequest,
  context: CustomerRouteContext,
): Promise<NextResponse> {
  if (!isAdminAuthenticated(request)) {
    return json({ status: "unauthorized" }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 16_384) {
    return json({ status: "validation_error" }, 400);
  }

  try {
    const { id } = await context.params;
    const input = updateCustomerInputSchema.parse(await request.json());
    const customer = await updateCustomer(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      id,
      input,
      { correlationId: correlationIdFromHeaders(request.headers) },
    );
    return json({ customer });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof PlatformInputError
    ) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof CustomerNotFoundError) {
      return json({ status: "customer_not_found" }, 404);
    }
    if (error instanceof CustomerShortCodeConflictError) {
      return json({ status: "short_code_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
