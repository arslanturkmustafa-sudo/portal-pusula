import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  FinanceAccountNotFoundError,
  FinanceAccountVersionConflictError,
  updateFinanceAccount,
  updateFinanceAccountInputSchema,
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
    const { id } = await context.params;
    const input = updateFinanceAccountInputSchema.parse(
      await readSpendingBody(request),
    );
    const account = await updateFinanceAccount(
      spendingDatabasePool(),
      id,
      input,
      { actorId: spendingActorId(principal), correlationId },
    );
    return spendingJson({ account });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError ||
      error instanceof PlatformInputError
    ) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof FinanceAccountNotFoundError) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof FinanceAccountVersionConflictError) {
      return spendingJson({ status: "version_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "finance_account.api.update_failed", mysqlErrorCode },
      `Finance account update failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
