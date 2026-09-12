import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CollectionAccountPermissionError,
  CollectionDateInFutureError,
  CollectionExceedsOutstandingError,
  createCollectionInputSchema,
  createReceivableCollection,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  FinanceIdempotencyConflictError,
  FinanceResourceNotFoundError,
  FinanceTransactionBeforeAccountOpeningError,
  FinanceTransactionFutureDateError,
  FinanceTransactionIdempotencyConflictError,
} from "@/features/finance";
import { spendingActorId } from "@/features/finance/spending-route-support";
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
  const principal = await authenticateAdminRequest(
    request,
    "finance.receivables.write",
  );
  if (!principal) {
    return json({ status: "unauthorized" }, 401);
  }
  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const input = createCollectionInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    const canMutateAccountLedger =
      hasPermission(principal, "finance.accounts.read") &&
      hasPermission(principal, "finance.accounts.write");
    if (!canMutateAccountLedger) {
      return json({ status: "forbidden" }, 403);
    }
    const result = await createReceivableCollection(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      input,
      {
        actorId: spendingActorId(principal),
        canMutateAccountLedger,
        correlationId: correlationIdFromHeaders(request.headers),
      },
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
    if (error instanceof CollectionAccountPermissionError) {
      return json({ status: "forbidden" }, 403);
    }
    if (error instanceof FinanceAccountNotFoundError) {
      return json({ status: "finance_account_not_found" }, 404);
    }
    if (error instanceof FinanceAccountInactiveError) {
      return json({ status: "finance_account_inactive" }, 409);
    }
    if (error instanceof FinanceTransactionFutureDateError) {
      return json({ status: "finance_transaction_future_date" }, 409);
    }
    if (error instanceof FinanceTransactionBeforeAccountOpeningError) {
      return json({ status: "finance_transaction_before_account_opening" }, 409);
    }
    if (error instanceof FinanceTransactionIdempotencyConflictError) {
      return json({ status: "idempotency_conflict" }, 409);
    }
    if (error instanceof FinanceIdempotencyConflictError) {
      return json({ status: "idempotency_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
