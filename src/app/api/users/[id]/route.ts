import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ManagedUserNotFoundError,
  ManagedUserOwnerProtectedError,
  ManagedUserVersionConflictError,
  updateManagedUser,
  updateManagedUserInputSchema,
} from "@/features/account";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = Readonly<{ params: Promise<{ id: string }> }>;

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<NextResponse> {
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401);
  if (!hasPermission(principal, "accounts.manage")) {
    return json({ status: "forbidden" }, 403);
  }
  if (principal.kind !== "account") {
    return json({ status: "account_setup_required" }, 409);
  }
  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { id } = await context.params;
    const input = updateManagedUserInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    const user = await updateManagedUser(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      id,
      input,
      {
        actorId: principal.accountId,
        correlationId: correlationIdFromHeaders(request.headers),
      },
    );
    return json({ user });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof PlatformInputError
    ) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof ManagedUserNotFoundError) {
      return json({ status: "not_found" }, 404);
    }
    if (error instanceof ManagedUserOwnerProtectedError) {
      return json({ status: "owner_protected" }, 409);
    }
    if (error instanceof ManagedUserVersionConflictError) {
      return json({ status: "version_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
