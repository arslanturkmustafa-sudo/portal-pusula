import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getNotificationSettings,
  updateNotificationSettings,
  updateNotificationSettingsInputSchema,
} from "@/features/settings";
import {
  authenticatePrincipalRequest,
  type AuthenticatedPrincipal,
} from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function databasePool() {
  return getPlatformDatabasePool(getDatabaseProbeEnvironment());
}

type OwnerAuthorization =
  | Readonly<{
      principal: Extract<AuthenticatedPrincipal, { kind: "account" }>;
    }>
  | Readonly<{ response: NextResponse }>;

async function databaseOwner(
  request: NextRequest,
): Promise<OwnerAuthorization> {
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) return { response: json({ status: "unauthorized" }, 401) };
  if (principal.role !== "owner") {
    return { response: json({ status: "forbidden" }, 403) };
  }
  if (principal.kind !== "account") {
    return { response: json({ status: "account_setup_required" }, 409) };
  }
  return { principal };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authorization = await databaseOwner(request);
  if (!("principal" in authorization)) return authorization.response;
  if ([...request.nextUrl.searchParams].length > 0) {
    return json({ status: "validation_error" }, 400);
  }

  try {
    const { principal } = authorization;
    return json({
      settings: await getNotificationSettings(
        databasePool(),
        principal.accountId,
        principal.email,
      ),
    });
  } catch {
    return json({ status: "service_unavailable" }, 503);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authorization = await databaseOwner(request);
  if (!("principal" in authorization)) return authorization.response;
  if (!isSameOriginWriteRequest(request)) {
    return json({ status: "forbidden" }, 403);
  }
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const input = updateNotificationSettingsInputSchema.parse(
      await readJsonWriteBody(request, 4_096),
    );
    const { principal } = authorization;
    return json({
      settings: await updateNotificationSettings(
        databasePool(),
        principal.accountId,
        input,
        {
          actorId: principal.accountId,
          correlationId: correlationIdFromHeaders(request.headers),
        },
      ),
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ status: "validation_error" }, 400);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
