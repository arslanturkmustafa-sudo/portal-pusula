import { NextRequest, NextResponse } from "next/server";

import { sessionCookieName, sessionCookieOptions } from "@/platform/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const production = process.env.NODE_ENV === "production";
  const response = NextResponse.redirect(new URL("/giris", request.url), 303);
  response.cookies.set({
    name: sessionCookieName(production),
    value: "",
    ...sessionCookieOptions(production),
    expires: new Date(0),
    maxAge: 0,
  });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}
