import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CollectionDateInFutureError,
  CollectionExceedsOutstandingError,
  createCollectionInputSchema,
  createReceivableCollection,
  FinanceIdempotencyConflictError,
  FinanceResourceNotFoundError,
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthenticated(request)) {
    return json({ status: "unauthorized" }, 401);
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 16_384) {
    return json({ status: "validation_error" }, 400);
  }

  try {
    const input = createCollectionInputSchema.parse(await request.json());
    const result = await createReceivableCollection(
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
    if (error instanceof CollectionExceedsOutstandingError) {
      return json({ status: "collection_exceeds_outstanding" }, 409);
    }
    if (error instanceof CollectionDateInFutureError) {
      return json({ status: "collection_date_in_future" }, 400);
    }
    if (error instanceof FinanceIdempotencyConflictError) {
      return json({ status: "idempotency_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
