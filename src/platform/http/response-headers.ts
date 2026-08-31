import { CORRELATION_ID_HEADER } from "@/platform/http/correlation-id";

export function noStoreResponseHeaders(correlationId: string): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "Content-Type": "application/json; charset=utf-8",
    [CORRELATION_ID_HEADER]: correlationId,
  });
}

