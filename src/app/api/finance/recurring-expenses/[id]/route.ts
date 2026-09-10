import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CreditCardInactiveError,
  ExpenseSourceAccountTypeError,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  RecurringExpensePlanNotFoundError,
  RecurringExpenseVersionConflictError,
  SpendingResourceNotFoundError,
  updateRecurringExpenseInputSchema,
  updateRecurringExpensePlan,
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
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function PATCH(
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
    const input = updateRecurringExpenseInputSchema.parse(
      await readSpendingBody(request),
    );
    const canUseAccountLedger =
      hasPermission(principal, "finance.accounts.read") &&
      hasPermission(principal, "finance.accounts.write");
    if (input.sourceAccountId !== null && !canUseAccountLedger) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    const plan = await updateRecurringExpensePlan(
      spendingDatabasePool(),
      id,
      input,
      {
        actorId: spendingActorId(principal),
        canMutateAccountLedger: canUseAccountLedger,
        correlationId,
      },
    );
    return spendingJson({ plan });
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
    if (error instanceof RecurringExpenseVersionConflictError) {
      return spendingJson({ status: "version_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "recurring_expense.api.update_failed", mysqlErrorCode },
      `Recurring expense update failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
