import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  changeContractLifecycle,
  ContractResourceNotFoundError,
  ContractVersionConflictError,
} from "@/features/contracts";
import {
  LifecycleDependencyConflictError,
  lifecycleCommandInputSchema,
  LifecycleParentUnavailableError,
  LifecycleStateConflictError,
} from "@/features/lifecycle";
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

type RouteContext = Readonly<{
  params: Promise<{ contractId: string; id: string }>;
}>;

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401);
  if (!hasPermission(principal, "contracts.lifecycle")) {
    return json({ status: "forbidden" }, 403);
  }
  if (principal.kind !== "account") {
    return json({ status: "account_principal_required" }, 403);
  }
  if (!isSameOriginWriteRequest(request)) {
    return json({ status: "forbidden" }, 403);
  }
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { contractId, id } = await context.params;
    const input = lifecycleCommandInputSchema.parse(
      await readJsonWriteBody(request, 4_096),
    );
    const contract = await changeContractLifecycle(
      getPlatformDatabasePool(getDatabaseProbeEnvironment()),
      id,
      contractId,
      input,
      {
        actorId: principal.accountId,
        correlationId: correlationIdFromHeaders(request.headers),
      },
    );
    return json({ status: "ok", version: contract.version });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof PlatformInputError
    ) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof ContractResourceNotFoundError) {
      return json({ status: "resource_not_found" }, 404);
    }
    if (error instanceof ContractVersionConflictError) {
      return json({ status: "version_conflict" }, 409);
    }
    if (error instanceof LifecycleDependencyConflictError) {
      return json({ status: "dependencies_present" }, 409);
    }
    if (error instanceof LifecycleParentUnavailableError) {
      return json({ status: "parent_unavailable" }, 409);
    }
    if (error instanceof LifecycleStateConflictError) {
      return json({ status: "state_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
