import { type NextRequest, NextResponse } from "next/server";

import {
  CORRELATION_ID_HEADER,
  createCorrelationId,
} from "@/platform/http/correlation-id";

export function proxy(request: NextRequest) {
  const correlationId = createCorrelationId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_ID_HEADER, correlationId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|offline-v1.html|sw.js).*)",
  ],
};

