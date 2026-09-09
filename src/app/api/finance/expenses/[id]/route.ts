import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CreditCardInactiveError,
  ExpenseAccountPermissionError,
  ExpenseAlreadyVoidedError,
  ExpensePlanLockedError,
  ExpenseSourceAccountTypeError,
  FinanceAccountInactiveError,
  FinanceAccountNotFoundError,
  FinanceTransactionAlreadyReversedError,
  FinanceTransactionBeforeAccountOpeningError,
  FinanceTransactionFutureDateError,
  SpendingResourceNotFoundError,
  SpendingVersionConflictError,
  updateExpense,
  updateExpenseInputSchema,
  voidExpense,
  voidExpenseInputSchema,
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
  const principal = await authenticateAdminRequest(request, "finance.expenses.write");
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const { id } = await context.params;
    const body = await readSpendingBody(request);
    const voidInput = voidExpenseInputSchema.safeParse(body);
    const updateInput = voidInput.success
      ? null
      : updateExpenseInputSchema.parse(body);
    if (
      (voidInput.success || updateInput?.status === "voided") &&
      !hasPermission(principal, "finance.expenses.reverse")
    ) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    const canMutateAccountLedger =
      hasPermission(principal, "finance.accounts.read") &&
      hasPermission(principal, "finance.accounts.write");
    if (
      updateInput?.sourceAccountId !== undefined &&
      updateInput.sourceAccountId !== null &&
      !canMutateAccountLedger
    ) {
      return spendingJson({ status: "forbidden" }, 403);
    }
    const writeContext = {
      actorId: spendingActorId(principal),
      canMutateAccountLedger,
      correlationId,
    };
    const expense = voidInput.success
      ? await voidExpense(spendingDatabasePool(), id, voidInput.data, writeContext)
      : await updateExpense(
          spendingDatabasePool(),
          id,
          updateInput ?? updateExpenseInputSchema.parse(body),
          writeContext,
        );
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
    if (error instanceof FinanceTransactionAlreadyReversedError) {
      return spendingJson({ status: "finance_transaction_already_reversed" }, 409);
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
