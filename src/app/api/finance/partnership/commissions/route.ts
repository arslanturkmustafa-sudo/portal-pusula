import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createCommissionInputSchema,
  createPartnershipCommission,
  listPartnershipCommissions,
  partnershipListFilterSchema,
  PartnershipFutureActualDateError,
  PartnershipIdempotencyConflictError,
  PartnershipProjectNotFoundError,
  PartnershipProjectTypeError,
} from "@/features/partnership-finance";
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
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { safeMySqlErrorCode } from "@/platform/logging/mysql-error-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS = new Set(["month", "projectId"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await authenticateAdminRequest(request))) {
    return spendingJson({ status: "unauthorized" }, 401);
  }
  try {
    const filters = partnershipListFilterSchema.parse(uniqueQuery(request, FILTERS));
    return spendingJson(await listPartnershipCommissions(spendingDatabasePool(), filters));
  } catch (error) {
    if (error instanceof z.ZodError) return spendingJson({ status: "validation_error" }, 400);
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) return spendingJson({ status: "unsupported_media_type" }, 415);
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const input = createCommissionInputSchema.parse(await readSpendingBody(request));
    const result = await createPartnershipCommission(spendingDatabasePool(), input, {
      actorId: spendingActorId(principal),
      correlationId,
    });
    return spendingJson(result, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof PartnershipProjectNotFoundError) return spendingJson({ status: "project_not_found" }, 404);
    if (error instanceof PartnershipFutureActualDateError) return spendingJson({ status: "future_actual_date" }, 400);
    if (error instanceof PartnershipProjectTypeError) return spendingJson({ status: "project_type_invalid" }, 409);
    if (error instanceof PartnershipIdempotencyConflictError) return spendingJson({ status: "idempotency_conflict" }, 409);
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "partnership_commission.api.database_failed", mysqlErrorCode },
      `Partnership commission API failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
