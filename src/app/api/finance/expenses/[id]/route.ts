import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CreditCardInactiveError,
  ExpenseAlreadyVoidedError,
  ExpensePlanLockedError,
  SpendingResourceNotFoundError,
  SpendingVersionConflictError,
  updateExpense,
  updateExpenseInputSchema,
} from "@/features/finance";
import {
  isJsonRequest,
  isSameOrigin,
  readSpendingBody,
  spendingActorId,
  spendingDatabasePool,
  spendingJson,
} from "@/features/finance/spending-route-support";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const { id } = await context.params;
    const input = updateExpenseInputSchema.parse(await readSpendingBody(request));
    const expense = await updateExpense(spendingDatabasePool(), id, input, {
      actorId: spendingActorId(principal),
      correlationId,
    });
    return spendingJson({ expense });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError ||
      error instanceof PlatformInputError
    ) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof SpendingResourceNotFoundError) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof CreditCardInactiveError) {
      return spendingJson({ status: "credit_card_inactive" }, 409);
    }
    if (error instanceof ExpensePlanLockedError) {
      return spendingJson({ status: "expense_plan_locked" }, 409);
    }
    if (error instanceof ExpenseAlreadyVoidedError) {
      return spendingJson({ status: "expense_already_voided" }, 409);
    }
    if (error instanceof SpendingVersionConflictError) {
      return spendingJson({ status: "version_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "expense.api.database_failed", mysqlErrorCode },
      `Expense API database operation failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
