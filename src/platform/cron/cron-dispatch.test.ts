import { describe, expect, it, vi } from "vitest";

import type { CronEnvironment } from "@/platform/config/cron-env.schema";
import {
  CRON_DISPATCH_BATCH_LIMIT,
  createCronDispatchHandler,
} from "@/platform/cron/cron-dispatch";

const cronToken = "A".repeat(43);
const enabledEnvironment: CronEnvironment = {
  bearerToken: cronToken,
  enabled: true,
  minimumIntervalSeconds: 60,
};

function permittedGate() {
  return vi.fn(async () => "permit" as const);
}

function request(
  authorization?: string,
  init: { method?: string; url?: string } = {},
): Request {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }
  return new Request(
    init.url ?? "https://portal.invalid/api/internal/cron/dispatch",
    { headers, method: init.method ?? "POST" },
  );
}

describe("internal cron dispatch boundary", () => {
  it("returns generic 404 without dispatch when disabled", async () => {
    const acquireGatePermit = permittedGate();
    const dispatch = vi.fn();
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment: () => ({ enabled: false }),
    });

    const response = await handler(request(`Bearer ${cronToken}`));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "not_found" });
    expect(acquireGatePermit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", `bearer ${cronToken}`, `Bearer  ${cronToken}`])(
    "returns generic 404 for non-exact authorization %j",
    async (authorization) => {
      const acquireGatePermit = permittedGate();
      const dispatch = vi.fn();
      const handler = createCronDispatchHandler({
        acquireGatePermit,
        dispatch,
        getEnvironment: () => enabledEnvironment,
      });

      const response = await handler(request(authorization));

      expect(response.status).toBe(404);
      expect(acquireGatePermit).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    `https://portal.invalid/api/internal/cron/dispatch?token=${cronToken}`,
    `https://portal.invalid/api/internal/cron/dispatch/${cronToken}`,
  ])("rejects a non-canonical route URL %s", async (url) => {
    const acquireGatePermit = permittedGate();
    const dispatch = vi.fn();
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment: () => enabledEnvironment,
    });
    const candidate = request(`Bearer ${cronToken}`, { url });

    const response = await handler(candidate);

    expect(response.status).toBe(404);
    expect(acquireGatePermit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects cookies even with exact header authorization", async () => {
    const acquireGatePermit = permittedGate();
    const dispatch = vi.fn();
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment: () => enabledEnvironment,
    });
    const candidate = request(`Bearer ${cronToken}`);
    candidate.headers.set("cookie", "unrelated=value");

    const response = await handler(candidate);

    expect(response.status).toBe(404);
    expect(acquireGatePermit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not read a token or payload from the request body", async () => {
    const acquireGatePermit = permittedGate();
    const dispatch = vi.fn();
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment: () => enabledEnvironment,
    });
    const payloadSentinel = "FAKE_CRON_PAYLOAD_SENTINEL";
    const bodyRequest = new Request(
      "https://portal.invalid/api/internal/cron/dispatch",
      {
        body: JSON.stringify({ payloadSentinel, token: cronToken }),
        headers: {
          authorization: `Bearer ${cronToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );

    const response = await handler(bodyRequest);
    const responseText = await response.text();

    expect(response.status).toBe(404);
    expect(acquireGatePermit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(responseText).not.toContain(payloadSentinel);
    expect(responseText).not.toContain(cronToken);
  });

  it("does not dispatch for a wrong method", async () => {
    const acquireGatePermit = permittedGate();
    const dispatch = vi.fn();
    const getEnvironment = vi.fn(() => enabledEnvironment);
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment,
    });

    const response = await handler(
      request(`Bearer ${cronToken}`, { method: "GET" }),
    );

    expect(response.status).toBe(404);
    expect(getEnvironment).not.toHaveBeenCalled();
    expect(acquireGatePermit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns generic 503 for invalid configuration or dispatch failure", async () => {
    const invalidHandler = createCronDispatchHandler({
      acquireGatePermit: permittedGate(),
      dispatch: vi.fn(),
      getEnvironment: () => {
        throw new Error("FAKE_SECRET_SENTINEL");
      },
    });
    const failureHandler = createCronDispatchHandler({
      acquireGatePermit: permittedGate(),
      dispatch: async () => {
        throw new Error("FAKE_RAW_DATABASE_SENTINEL");
      },
      getEnvironment: () => enabledEnvironment,
    });

    const invalid = await invalidHandler(request(`Bearer ${cronToken}`));
    const failure = await failureHandler(request(`Bearer ${cronToken}`));

    expect(invalid.status).toBe(503);
    expect(failure.status).toBe(503);
    expect(`${await invalid.text()}${await failure.text()}`).not.toMatch(
      /FAKE_(?:SECRET|RAW_DATABASE)_SENTINEL/u,
    );
  });

  it("dispatches a bounded batch and returns generic no-store 202", async () => {
    const acquireGatePermit = permittedGate();
    const dispatch = vi.fn(async () => undefined);
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment: () => enabledEnvironment,
    });
    const correlationId = "018f3ef5-68f2-7d86-9c95-1f0267f2e7ab";
    const authorizedRequest = request(`Bearer ${cronToken}`);
    authorizedRequest.headers.set("x-correlation-id", correlationId);

    const response = await handler(authorizedRequest);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(acquireGatePermit).toHaveBeenCalledExactlyOnceWith({
      correlationId,
      minimumIntervalSeconds: 60,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchLimit: CRON_DISPATCH_BATCH_LIMIT,
        correlationId,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("aborts and returns generic 503 when the short deadline expires", async () => {
    let dispatchSignal: AbortSignal | undefined;
    const handler = createCronDispatchHandler({
      acquireGatePermit: permittedGate(),
      deadlineMs: 1,
      dispatch: ({ signal }) => {
        dispatchSignal = signal;
        return new Promise<void>(() => undefined);
      },
      getEnvironment: () => enabledEnvironment,
    });

    const response = await handler(request(`Bearer ${cronToken}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(dispatchSignal?.aborted).toBe(true);
  });

  it("returns the same generic 202 while suppressing dispatch inside the gate window", async () => {
    const acquireGatePermit = vi.fn(async () => "suppressed" as const);
    const dispatch = vi.fn();
    const handler = createCronDispatchHandler({
      acquireGatePermit,
      dispatch,
      getEnvironment: () => enabledEnvironment,
    });
    const correlationId = "018f3ef5-68f2-7d86-9c95-1f0267f2e7ab";
    const candidate = request(`Bearer ${cronToken}`);
    candidate.headers.set("x-correlation-id", correlationId);

    const response = await handler(candidate);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(acquireGatePermit).toHaveBeenCalledExactlyOnceWith({
      correlationId,
      minimumIntervalSeconds: 60,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails closed with a generic 503 for gate failures or invalid outcomes", async () => {
    const rawSentinel = "RAW_CRON_GATE_DATABASE_SENTINEL";
    const failureDispatch = vi.fn();
    const failureHandler = createCronDispatchHandler({
      acquireGatePermit: async () => {
        throw new Error(rawSentinel);
      },
      dispatch: failureDispatch,
      getEnvironment: () => enabledEnvironment,
    });
    const invalidDispatch = vi.fn();
    const invalidHandler = createCronDispatchHandler({
      acquireGatePermit: async () =>
        "unexpected" as unknown as "permit",
      dispatch: invalidDispatch,
      getEnvironment: () => enabledEnvironment,
    });

    const failureResponse = await failureHandler(
      request(`Bearer ${cronToken}`),
    );
    const invalidResponse = await invalidHandler(
      request(`Bearer ${cronToken}`),
    );
    const bodies = `${await failureResponse.text()}${await invalidResponse.text()}`;

    expect(failureResponse.status).toBe(503);
    expect(invalidResponse.status).toBe(503);
    expect(bodies).not.toContain(rawSentinel);
    expect(failureDispatch).not.toHaveBeenCalled();
    expect(invalidDispatch).not.toHaveBeenCalled();
  });
});
