import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createExpense,
  createExpenseInputSchema,
  CreditCardInactiveError,
  ExpenseAccountPermissionError,
  ExpenseSourceAccountTypeError,
  expenseListFilterSchema,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  FinanceTransactionBeforeAccountOpeningError,
  FinanceTransactionFutureDateError,
  listExpenses,
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
  uniqueQuery,
} from "@/features/finance/spending-route-support";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { hasPermission } from "@/platform/auth/permissions";
import { emailNotificationsEnabled } from "@/platform/config/email-env";
import { scheduleEmailOutboxDispatch } from "@/platform/email/immediate-dispatch";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS = new Set(["category", "month", "paymentMethod", "projectId"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request, "finance.expenses.read");
  if (!principal) {
    return spendingJson({ status: "unauthorized" }, 401);
  }
  try {
    const filters = expenseListFilterSchema.parse(uniqueQuery(request, FILTERS));
    const collection = await listExpenses(spendingDatabasePool(), filters);
    if (hasPermission(principal, "finance.accounts.read")) {
      return spendingJson(collection);
    }
    return spendingJson({
      ...collection,
      expenses: collection.expenses.map((expense) => ({
        ...expense,
        financeTransactionId: null,
        sourceAccountId: null,
        sourceAccountName: null,
        sourceAccountType: null,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request, "finance.expenses.write");
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createExpenseInputSchema.parse(await readSpendingBody(request));
    const canMutateAccountLedger =
      hasPermission(principal, "finance.accounts.read") &&
      hasPermission(principal, "finance.accounts.write");
    if (input.sourceAccountId !== null && !canMutateAccountLedger) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    const shouldNotify = emailNotificationsEnabled();
    const result = await createExpense(spendingDatabasePool(), input, {
      actorId: spendingActorId(principal),
      canMutateAccountLedger,
      correlationId,
      emailNotificationsEnabled: shouldNotify,
    });
    if (result.created && shouldNotify) {
      scheduleEmailOutboxDispatch(correlationId);
    }
    return spendingJson(result, result.created ? 201 : 200);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError
    ) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof SpendingResourceNotFoundError) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof CreditCardInactiveError) {
      return spendingJson({ status: "credit_card_inactive" }, 409);
    }
    if (error instanceof ExpenseAccountPermissionError) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    if (error instanceof FinanceAccountNotFoundError) {
      return spendingJson({ status: "finance_account_not_found" }, 404);
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
      return spendingJson({ status: "finance_transaction_before_account_opening" }, 409);
    }
    if (error instanceof SpendingIdempotencyConflictError) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "expense.api.database_failed", mysqlErrorCode },
      `Expense API database operation failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
