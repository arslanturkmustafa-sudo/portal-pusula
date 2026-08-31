import type { CronEnvironment } from "@/platform/config/cron-env.schema";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { noStoreResponseHeaders } from "@/platform/http/response-headers";
import { hasExactBearerAuthorization } from "@/platform/security/exact-bearer";

export const CRON_DISPATCH_BATCH_LIMIT = 10;
export const CRON_DISPATCH_DEADLINE_MS = 4_000;
export const CRON_DISPATCH_GATE_KEY = "platform-cron-dispatch";
export const CRON_DISPATCH_PATH = "/api/internal/cron/dispatch";

export type CronDispatchRequest = {
  batchLimit: number;
  correlationId: string;
  signal: AbortSignal;
};

export type CronDispatchGateRequest = {
  correlationId: string;
  minimumIntervalSeconds: number;
};

export type CronDispatchGateResult = "permit" | "suppressed";

export type CronDispatchDependencies = {
  acquireGatePermit: (
    request: CronDispatchGateRequest,
  ) => Promise<CronDispatchGateResult>;
  deadlineMs?: number;
  dispatch: (request: CronDispatchRequest) => Promise<void>;
  getEnvironment: () => CronEnvironment;
};

function isExactCronDispatchRequest(request: Request): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  const contentLength = request.headers.get("content-length");
  const hasPayloadMetadata =
    (contentLength !== null && contentLength !== "0") ||
    request.headers.has("transfer-encoding") ||
    request.headers.has("content-encoding") ||
    request.headers.has("content-type");

  return (
    url.pathname === CRON_DISPATCH_PATH &&
    url.search === "" &&
    url.hash === "" &&
    !hasPayloadMetadata &&
    !request.headers.has("cookie")
  );
}

function cronResponse(
  status: "accepted" | "not_found" | "unavailable",
  statusCode: number,
  correlationId: string,
): Response {
  return new Response(JSON.stringify({ status }), {
    status: statusCode,
    headers: noStoreResponseHeaders(correlationId),
  });
}

async function dispatchWithinDeadline(
  dispatch: CronDispatchDependencies["dispatch"],
  correlationId: string,
  deadlineMs: number,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Cron dispatch deadline exceeded."));
      controller.abort();
    }, deadlineMs);
  });

  try {
    await Promise.race([
      dispatch({
        batchLimit: CRON_DISPATCH_BATCH_LIMIT,
        correlationId,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createCronDispatchHandler({
  acquireGatePermit,
  deadlineMs = CRON_DISPATCH_DEADLINE_MS,
  dispatch,
  getEnvironment,
}: CronDispatchDependencies) {
  return async function cronDispatchHandler(
    request: Request,
  ): Promise<Response> {
    const correlationId = correlationIdFromHeaders(request.headers);

    if (request.method !== "POST" || !isExactCronDispatchRequest(request)) {
      return cronResponse("not_found", 404, correlationId);
    }

    let environment: CronEnvironment;
    try {
      environment = getEnvironment();
    } catch {
      return cronResponse("unavailable", 503, correlationId);
    }

    if (!environment.enabled) {
      return cronResponse("not_found", 404, correlationId);
    }

    let authorized = false;
    try {
      authorized = hasExactBearerAuthorization(
        request,
        environment.bearerToken,
      );
    } catch {
      authorized = false;
    }
    if (!authorized) {
      return cronResponse("not_found", 404, correlationId);
    }

    try {
      const gateResult = await acquireGatePermit({
        correlationId,
        minimumIntervalSeconds: environment.minimumIntervalSeconds,
      });
      if (gateResult === "suppressed") {
        return cronResponse("accepted", 202, correlationId);
      }
      if (gateResult !== "permit") {
        return cronResponse("unavailable", 503, correlationId);
      }

      await dispatchWithinDeadline(dispatch, correlationId, deadlineMs);
      return cronResponse("accepted", 202, correlationId);
    } catch {
      return cronResponse("unavailable", 503, correlationId);
    }
  };
}
