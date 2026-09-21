import { projectScope } from "@/platform/auth/project-access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createCustomer,
  createCustomerInputSchema,
  CustomerProjectNotFoundError,
  CustomerProjectUnavailableError,
  CustomerShortCodeConflictError,
  listCustomers,
} from "@/features/customers";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

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

function databasePool() {
  return getPlatformDatabasePool(getDatabaseProbeEnvironment());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) {
    return json({ status: "unauthorized" }, 401);
  }
  if (!hasPermission(principal, "customers.read")) {
    return json({ status: "forbidden" }, 403);
  }

  try {
    const customers = await listCustomers(databasePool(), {
      projectIds: projectScope(principal),
      includeBilling: hasPermission(principal, "contracts.billing.read"),
      includeContact: hasPermission(principal, "customers.contact.read"),
      includeVisits: hasPermission(principal, "visits.read"),
    });
    return json({ customers });
  } catch {
    return json({ status: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) {
    return json({ status: "unauthorized" }, 401);
  }
  if (
    !hasPermission(principal, "customers.write") ||
    !hasPermission(principal, "customers.contact.read")
  ) {
    return json({ status: "forbidden" }, 403);
  }

  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createCustomerInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    const customer = await createCustomer(databasePool(), input, {
      actorId: principal.kind === "account" ? principal.accountId : undefined,
      correlationId,
    });
    return json({ customer }, 201);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ status: "validation_error" }, 400);
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
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      {
        event: "customer.api.database_failed",
        method: "POST",
        mysqlErrorCode,
        pathname: "/api/customers",
      },
      `Customer API database operation failed: ${mysqlErrorCode}`,
    );
    return json({ status: "service_unavailable" }, 503);
  }
}
