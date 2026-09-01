import { NextRequest, NextResponse } from "next/server";

import { legacyAccountSummary } from "@/features/account";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";
import { getAuthEnvironment } from "@/platform/config/auth-env";
import { getAuthStorageMode } from "@/platform/config/auth-storage-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request);
  if (!principal) return json({ status: "unauthorized" }, 401);

  if (principal.kind === "development") {
    return json({
      account: {
        email: "Yerel geliştirme oturumu",
        passwordChangedAtUtc: null,
        passwordManagementAvailable: false,
        requiresCurrentPassword: false,
      },
    });
  }

  if (principal.kind === "legacy") {
    try {
      const passwordManagementAvailable =
        getAuthStorageMode() === "database";
      return json({
        account: {
          ...legacyAccountSummary(getAuthEnvironment()),
          passwordManagementAvailable,
        },
      });
    } catch {
      return json({ status: "service_unavailable" }, 503);
    }
  }

  return json({
    account: {
      email: principal.email,
      passwordChangedAtUtc: principal.passwordChangedAtUtc,
      passwordManagementAvailable: true,
      requiresCurrentPassword: true,
    },
  });
}
