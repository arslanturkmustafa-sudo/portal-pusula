import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  PartnershipIdempotencyConflictError,
  PartnershipReceiptAlreadyReversedError,
  PartnershipReceiptNotReversibleError,
  PartnershipRecordNotFoundError,
  PartnershipVersionConflictError,
  reverseContributionReceiptInputSchema,
  reversePartnershipContributionReceipt,
} from "@/features/partnership-finance";
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

type Context = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(
    request,
    "finance.partnership.reverse",
  );
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const { id } = await context.params;
    const input = reverseContributionReceiptInputSchema.parse(
      await readSpendingBody(request),
    );
    const result = await reversePartnershipContributionReceipt(
      spendingDatabasePool(),
      id,
      input,
      { actorId: spendingActorId(principal), correlationId },
    );
    return spendingJson(result, result.created ? 201 : 200);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof RangeError ||
      error instanceof PlatformInputError
    ) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof PartnershipRecordNotFoundError) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof PartnershipReceiptNotReversibleError) {
      return spendingJson({ status: "receipt_not_reversible" }, 409);
    }
    if (error instanceof PartnershipReceiptAlreadyReversedError) {
      return spendingJson({ status: "receipt_already_reversed" }, 409);
    }
    if (error instanceof PartnershipIdempotencyConflictError) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    if (error instanceof PartnershipVersionConflictError) {
      return spendingJson({ status: "version_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "partnership.receipt_reverse.api.database_failed", mysqlErrorCode },
      `Partnership receipt reversal API failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
