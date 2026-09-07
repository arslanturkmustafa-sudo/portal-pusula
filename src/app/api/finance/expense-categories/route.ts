import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createExpenseCategory,
  createExpenseCategoryInputSchema,
  ExpenseCategoryAlreadyExistsError,
  ExpenseCategoryIdempotencyConflictError,
  listExpenseCategories,
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
  if (!(await authenticateAdminRequest(request, "finance.expenses.read"))) {
    return spendingJson({ status: "unauthorized" }, 401);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    return spendingJson(await listExpenseCategories(spendingDatabasePool()));
  } catch (error) {
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "expense_category.api.list_failed", mysqlErrorCode },
      `Expense category list failed: ${mysqlErrorCode}`,
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
  if (!hasPermission(principal, "finance.expenses.read")) {
    return spendingJson({ status: "forbidden" }, 403);
  }
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createExpenseCategoryInputSchema.parse(
      await readSpendingBody(request),
    );
    const result = await createExpenseCategory(spendingDatabasePool(), input, {
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
    if (error instanceof ExpenseCategoryAlreadyExistsError) {
      return spendingJson({ status: "category_already_exists" }, 409);
    }
    if (error instanceof ExpenseCategoryIdempotencyConflictError) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "expense_category.api.create_failed", mysqlErrorCode },
      `Expense category create failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
