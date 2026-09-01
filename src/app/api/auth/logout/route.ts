import { NextResponse } from "next/server";

import { sessionCookieName, sessionCookieOptions } from "@/platform/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const production = process.env.NODE_ENV === "production";
  const response = new NextResponse(null, {
    headers: { Location: "/giris" },
    status: 303,
  });
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
