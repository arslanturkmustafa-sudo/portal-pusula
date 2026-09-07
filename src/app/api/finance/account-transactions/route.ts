import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createFinanceTransaction,
  createFinanceTransactionInputSchema,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  FinanceTransactionBeforeAccountOpeningError,
  FinanceTransactionFutureDateError,
  FinanceTransactionIdempotencyConflictError,
} from "@/features/finance";
import {
  isJsonRequest,
  isSameOrigin,
  readSpendingBody,
  spendingActorId,
  spendingDatabasePool,
  spendingJson,
} from "@/features/finance/spending-route-support";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request, "finance.accounts.write");
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!hasPermission(principal, "finance.accounts.read")) {
    return spendingJson({ status: "forbidden" }, 403);
  }
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createFinanceTransactionInputSchema.parse(
      await readSpendingBody(request),
    );
    const result = await createFinanceTransaction(spendingDatabasePool(), input, {
      actorId: spendingActorId(principal),
      correlationId,
    });
    return spendingJson(result, result.created ? 201 : 200);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError
    ) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof FinanceAccountNotFoundError) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof FinanceAccountInactiveError) {
      return spendingJson({ status: "account_inactive" }, 409);
    }
    if (error instanceof FinanceTransactionFutureDateError) {
      return spendingJson({ status: "future_date" }, 409);
    }
    if (error instanceof FinanceTransactionBeforeAccountOpeningError) {
      return spendingJson({ status: "before_account_opening" }, 400);
    }
    if (error instanceof FinanceTransactionIdempotencyConflictError) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "finance_transaction.api.create_failed", mysqlErrorCode },
      `Finance transaction create failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
