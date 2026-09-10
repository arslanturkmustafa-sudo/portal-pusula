import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CreditCardInactiveError,
  ExpenseAccountPermissionError,
  ExpenseSourceAccountTypeError,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  FinanceTransactionBeforeAccountOpeningError,
  FinanceTransactionFutureDateError,
  realizeRecurringExpenseInputSchema,
  realizeRecurringExpensePlan,
  RecurringExpenseIdempotencyConflictError,
  RecurringExpenseNotDueError,
  RecurringExpensePlanNotFoundError,
  RecurringExpensePlanPausedError,
  RecurringExpenseVersionConflictError,
  SpendingIdempotencyConflictError,
  SpendingResourceNotFoundError,
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
import { emailNotificationsEnabled } from "@/platform/config/email-env";
import { scheduleEmailOutboxDispatch } from "@/platform/email/immediate-dispatch";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(
    request,
    "finance.expenses.write",
  );
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const { id } = await context.params;
    const input = realizeRecurringExpenseInputSchema.parse(
      await readSpendingBody(request),
    );
    const canUseAccountLedger =
      hasPermission(principal, "finance.accounts.read") &&
      hasPermission(principal, "finance.accounts.write");
    const shouldNotify = emailNotificationsEnabled();
    const result = await realizeRecurringExpensePlan(
      spendingDatabasePool(),
      id,
      input,
      {
        actorId: spendingActorId(principal),
        canMutateAccountLedger: canUseAccountLedger,
        correlationId,
        emailNotificationsEnabled: shouldNotify,
      },
    );
    if (shouldNotify) scheduleEmailOutboxDispatch(correlationId);
    return spendingJson(result, 201);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError ||
      error instanceof PlatformInputError
    ) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (
      error instanceof RecurringExpensePlanNotFoundError ||
      error instanceof SpendingResourceNotFoundError
    ) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof ExpenseAccountPermissionError) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    if (error instanceof FinanceAccountNotFoundError) {
      return spendingJson({ status: "finance_account_not_found" }, 404);
    }
    if (error instanceof CreditCardInactiveError) {
      return spendingJson({ status: "credit_card_inactive" }, 409);
    }
    if (error instanceof FinanceAccountInactiveError) {
      return spendingJson({ status: "finance_account_inactive" }, 409);
    }
    if (error instanceof ExpenseSourceAccountTypeError) {
      return spendingJson({ status: "finance_account_type_mismatch" }, 409);
    }
    if (error instanceof FinanceTransactionFutureDateError) {
      return spendingJson({ status: "finance_transaction_future_date" }, 409);
    }
    if (error instanceof FinanceTransactionBeforeAccountOpeningError) {
      return spendingJson(
        { status: "finance_transaction_before_account_opening" },
        409,
      );
    }
    if (
      error instanceof RecurringExpenseVersionConflictError ||
      error instanceof RecurringExpensePlanPausedError ||
      error instanceof RecurringExpenseNotDueError
    ) {
      const status =
        error instanceof RecurringExpenseVersionConflictError
          ? "version_conflict"
          : error instanceof RecurringExpensePlanPausedError
            ? "plan_paused"
            : "not_due";
      return spendingJson({ status }, 409);
    }
    if (
      error instanceof RecurringExpenseIdempotencyConflictError ||
      error instanceof SpendingIdempotencyConflictError
    ) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "recurring_expense.api.realize_failed", mysqlErrorCode },
      `Recurring expense realization failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
