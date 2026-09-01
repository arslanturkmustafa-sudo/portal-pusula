import { NextRequest, NextResponse } from "next/server";

import {
  createSessionToken,
  sessionCookieName,
  sessionCookieOptions,
} from "@/platform/auth/session";
import { verifyAdminCredentials } from "@/platform/auth/password";
import { getAuthEnvironment } from "@/platform/config/auth-env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FORM_BYTES = 4_096;

function sameOriginRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    headers: { Location: location },
    status: 303,
  });
}

function failedLogin(): NextResponse {
  const response = sameOriginRedirect("/giris?hata=1");
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_FORM_BYTES
  ) {
    return failedLogin();
  }

  try {
    const formData = await request.formData();
    const email = formData.get("email");
    const password = formData.get("password");
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length < 1 ||
      password.length > 256
    ) {
      return failedLogin();
    }

    const environment = getAuthEnvironment();
    const valid = await verifyAdminCredentials(email, password, environment);
    if (!valid) return failedLogin();

    const production = process.env.NODE_ENV === "production";
    const response = sameOriginRedirect("/");
    response.cookies.set({
      name: sessionCookieName(production),
      value: createSessionToken(environment.SESSION_SECRET),
      ...sessionCookieOptions(production),
    });
    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, must-revalidate",
    );
    return response;
  } catch {
    return failedLogin();
  }
}
