import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createRecurringExpenseInputSchema,
  createRecurringExpensePlan,
  CreditCardInactiveError,
  ExpenseSourceAccountTypeError,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  listRecurringExpensePlans,
  RecurringExpenseIdempotencyConflictError,
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
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(
    request,
    "finance.expenses.read",
  );
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const plans = await listRecurringExpensePlans(spendingDatabasePool());
    if (hasPermission(principal, "finance.accounts.read")) {
      return spendingJson({ plans });
    }
    return spendingJson({
      plans: plans.map((plan) => ({
        ...plan,
        sourceAccountId: null,
        sourceAccountName: null,
        sourceAccountType: null,
      })),
    });
  } catch (error) {
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "recurring_expense.api.list_failed", mysqlErrorCode },
      `Recurring expense list failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    const input = createRecurringExpenseInputSchema.parse(
      await readSpendingBody(request),
    );
    const canUseAccountLedger =
      hasPermission(principal, "finance.accounts.read") &&
      hasPermission(principal, "finance.accounts.write");
    if (input.sourceAccountId !== null && !canUseAccountLedger) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    const result = await createRecurringExpensePlan(
      spendingDatabasePool(),
      input,
      {
        actorId: spendingActorId(principal),
        canMutateAccountLedger: canUseAccountLedger,
        correlationId,
      },
    );
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
    if (error instanceof RecurringExpenseIdempotencyConflictError) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "recurring_expense.api.create_failed", mysqlErrorCode },
      `Recurring expense create failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
