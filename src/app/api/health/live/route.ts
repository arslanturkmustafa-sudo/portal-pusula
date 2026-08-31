import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { noStoreResponseHeaders } from "@/platform/http/response-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  const correlationId = correlationIdFromHeaders(request.headers);

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: noStoreResponseHeaders(correlationId),
  });
}

