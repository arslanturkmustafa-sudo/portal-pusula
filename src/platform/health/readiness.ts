import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { noStoreResponseHeaders } from "@/platform/http/response-headers";

export type ReadinessAuthorization = (
  request: Request,
) => boolean | Promise<boolean>;

export type ReadinessCheck = () => boolean | Promise<boolean>;

type ReadinessDependencies = {
  authorize: ReadinessAuthorization;
  check: ReadinessCheck;
};

function readinessResponse(
  status: "not_found" | "ready" | "unavailable",
  statusCode: number,
  correlationId: string,
): Response {
  return new Response(JSON.stringify({ status }), {
    status: statusCode,
    headers: noStoreResponseHeaders(correlationId),
  });
}

export function createReadinessHandler({
  authorize,
  check,
}: ReadinessDependencies) {
  return async function readinessHandler(request: Request): Promise<Response> {
    const correlationId = correlationIdFromHeaders(request.headers);
    let authorized = false;

    try {
      authorized = await authorize(request);
    } catch {
      authorized = false;
    }

    if (!authorized) {
      return readinessResponse("not_found", 404, correlationId);
    }

    try {
      const ready = await check();
      return readinessResponse(
        ready ? "ready" : "unavailable",
        ready ? 200 : 503,
        correlationId,
      );
    } catch {
      return readinessResponse("unavailable", 503, correlationId);
    }
  };
}

export const denyAllReadiness: ReadinessAuthorization = () => false;
