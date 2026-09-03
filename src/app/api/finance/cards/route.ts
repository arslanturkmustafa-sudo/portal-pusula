import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createCreditCard,
  createCreditCardInputSchema,
  listCreditCards,
  SpendingIdempotencyConflictError,
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await authenticateAdminRequest(request))) {
    return spendingJson({ status: "unauthorized" }, 401);
  }
  if ([...request.nextUrl.searchParams].length > 0) {
    return spendingJson({ status: "validation_error" }, 400);
  }
  try {
    return spendingJson({ cards: await listCreditCards(spendingDatabasePool()) });
  } catch {
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) {
    return spendingJson({ status: "unsupported_media_type" }, 415);
  }
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createCreditCardInputSchema.parse(await readSpendingBody(request));
    const result = await createCreditCard(spendingDatabasePool(), input, {
      actorId: spendingActorId(principal),
      correlationId,
    });
    return spendingJson(result, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof SpendingIdempotencyConflictError) {
      return spendingJson({ status: "idempotency_conflict" }, 409);
    }
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "credit_card.api.database_failed", mysqlErrorCode },
      `Credit card API database operation failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
