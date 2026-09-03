import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CustomerNotFoundError,
  CustomerProjectInUseError,
  CustomerProjectNotFoundError,
  CustomerProjectUnavailableError,
  CustomerProjectVersionConflictError,
  CustomerShortCodeConflictError,
  updateCustomer,
  updateCustomerInputSchema,
} from "@/features/customers";
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
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { id } = await context.params;
    const input = updateCustomerInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
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
    if (error instanceof CustomerProjectNotFoundError) {
      return json({ status: "project_not_found" }, 404);
    }
    if (error instanceof CustomerProjectUnavailableError) {
      return json({ status: "project_unavailable" }, 409);
    }
    if (error instanceof CustomerProjectInUseError) {
      return json({ status: "project_link_in_use" }, 409);
    }
    if (error instanceof CustomerProjectVersionConflictError) {
      return json({ status: "project_link_version_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
