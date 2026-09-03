import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  PartnershipProjectNotFoundError,
  PartnershipFutureActualDateError,
  PartnershipProjectTypeError,
  PartnershipRecordLockedError,
  PartnershipRecordNotFoundError,
  PartnershipStatusTransitionError,
  PartnershipVersionConflictError,
  updateCommissionInputSchema,
  updatePartnershipCommission,
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

export async function PATCH(request: NextRequest, context: Context): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return spendingJson({ status: "unauthorized" }, 401);
  if (!isSameOrigin(request)) return spendingJson({ status: "forbidden" }, 403);
  if (!isJsonRequest(request)) return spendingJson({ status: "unsupported_media_type" }, 415);
  const correlationId = correlationIdFromHeaders(request.headers);
  try {
    const { id } = await context.params;
    const input = updateCommissionInputSchema.parse(await readSpendingBody(request));
    const commission = await updatePartnershipCommission(spendingDatabasePool(), id, input, {
      actorId: spendingActorId(principal),
      correlationId,
    });
    return spendingJson({ commission });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError || error instanceof PlatformInputError) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    if (error instanceof PartnershipRecordNotFoundError || error instanceof PartnershipProjectNotFoundError) {
      return spendingJson({ status: "resource_not_found" }, 404);
    }
    if (error instanceof PartnershipFutureActualDateError) return spendingJson({ status: "future_actual_date" }, 400);
    if (error instanceof PartnershipProjectTypeError) return spendingJson({ status: "project_type_invalid" }, 409);
    if (error instanceof PartnershipRecordLockedError) return spendingJson({ status: "record_locked" }, 409);
    if (error instanceof PartnershipStatusTransitionError) return spendingJson({ status: "status_transition_invalid" }, 409);
    if (error instanceof PartnershipVersionConflictError) return spendingJson({ status: "version_conflict" }, 409);
    const mysqlErrorCode = safeMySqlErrorCode(error);
    requestLogger(correlationId).error(
      { event: "partnership_commission.api.database_failed", mysqlErrorCode },
      `Partnership commission API failed: ${mysqlErrorCode}`,
    );
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
