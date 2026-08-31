import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import { createConfiguredCronDispatchHandler } from "@/platform/cron/configured-cron-dispatch-core";
import {
  CRON_DISPATCH_BATCH_LIMIT,
  CRON_DISPATCH_GATE_KEY,
} from "@/platform/cron/cron-dispatch";

const CRON_TOKEN = "C".repeat(43);
const RAW_SENTINEL = "raw-db-secret-error-value";

const databaseEnvironment: DatabaseProbeEnvironment = {
  DB_HOST: "localhost",
  DB_PORT: 3306,
  DB_NAME: "private_database_name",
  DB_USER: "private_user",
  DB_PASSWORD: "fake_private_password",
};

function createHarness(
  options: {
    enabled?: boolean;
    gateDecision?: "permit" | "suppressed";
    lockAcquired?: boolean;
  } = {},
) {
  const pool = {} as Pool;
  const acquirePermit = vi
    .fn()
    .mockResolvedValue(options.gateDecision ?? "permit");
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const getDatabaseEnvironment = vi
    .fn()
    .mockReturnValue(databaseEnvironment);
  const getEnvironment = vi.fn().mockReturnValue(
    options.enabled === false
      ? { enabled: false }
      : {
          bearerToken: CRON_TOKEN,
          enabled: true,
          minimumIntervalSeconds: 300,
        },
  );
  const getPool = vi.fn().mockReturnValue(pool);
  const runWithLock = vi
    .fn()
    .mockImplementation(
      async (
        _pool: Pool,
        _databaseName: string,
        _signal: AbortSignal,
        operation: () => Promise<void>,
      ) => {
        if (options.lockAcquired === false) return false;
        await operation();
        return true;
      },
    );
  const handler = createConfiguredCronDispatchHandler({
    acquirePermit,
    dispatch,
    getDatabaseEnvironment,
    getEnvironment,
    getPool,
    runWithLock,
  });

  return {
    acquirePermit,
    dispatch,
    getDatabaseEnvironment,
    getEnvironment,
    getPool,
    handler,
    pool,
    runWithLock,
  };
}

function authorizedRequest(): Request {
  return new Request("http://localhost/api/internal/cron/dispatch", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_TOKEN}` },
  });
}

describe("configured cron dispatch boundary", () => {
  it("does not resolve database state while disabled", async () => {
    const harness = createHarness({ enabled: false });

    const response = await harness.handler(authorizedRequest());

    expect(response.status).toBe(404);
    expect(harness.acquirePermit).not.toHaveBeenCalled();
    expect(harness.getDatabaseEnvironment).not.toHaveBeenCalled();
    expect(harness.getPool).not.toHaveBeenCalled();
    expect(harness.runWithLock).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("does not resolve database state before exact authorization", async () => {
    const harness = createHarness();
    const response = await harness.handler(
      new Request("http://localhost/api/internal/cron/dispatch", {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_TOKEN}x` },
      }),
    );

    expect(response.status).toBe(404);
    expect(harness.acquirePermit).not.toHaveBeenCalled();
    expect(harness.getDatabaseEnvironment).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("runs one bounded dispatch while the derived database lock is held", async () => {
    const harness = createHarness();

    const response = await harness.handler(authorizedRequest());

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-correlation-id")).toBeTruthy();
    expect(harness.acquirePermit).toHaveBeenCalledExactlyOnceWith(
      harness.pool,
      {
        gateKey: CRON_DISPATCH_GATE_KEY,
        minimumIntervalSeconds: 300,
      },
    );
    expect(harness.getPool).toHaveBeenCalledWith(databaseEnvironment);
    expect(harness.runWithLock).toHaveBeenCalledOnce();
    expect(harness.runWithLock.mock.calls[0]?.[0]).toBe(harness.pool);
    expect(harness.runWithLock.mock.calls[0]?.[1]).toBe(
      databaseEnvironment.DB_NAME,
    );
    expect(harness.dispatch).toHaveBeenCalledOnce();
    expect(
      harness.acquirePermit.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.runWithLock.mock.invocationCallOrder[0] ?? 0);
    expect(harness.dispatch.mock.calls[0]?.[0]).toBe(harness.pool);
    expect(harness.dispatch.mock.calls[0]?.[1]).toMatchObject({
      batchLimit: CRON_DISPATCH_BATCH_LIMIT,
      correlationId: response.headers.get("x-correlation-id"),
    });
    expect(harness.dispatch.mock.calls[0]?.[1].signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it("returns the generic accepted contract without lock or dispatch when the gate suppresses", async () => {
    const harness = createHarness({ gateDecision: "suppressed" });

    const response = await harness.handler(authorizedRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(harness.acquirePermit).toHaveBeenCalledOnce();
    expect(harness.runWithLock).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("accepts a safe no-op when another dispatcher owns the lock", async () => {
    const harness = createHarness({ lockAcquired: false });

    const response = await harness.handler(authorizedRequest());

    expect(response.status).toBe(202);
    expect(harness.acquirePermit).toHaveBeenCalledOnce();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("returns only generic unavailable when gate, DB setup, or dispatch fails", async () => {
    const gateFailure = createHarness();
    gateFailure.acquirePermit.mockRejectedValue(new Error(RAW_SENTINEL));
    const gateResponse = await gateFailure.handler(authorizedRequest());

    const setupFailure = createHarness();
    setupFailure.getDatabaseEnvironment.mockImplementation(() => {
      throw new Error(RAW_SENTINEL);
    });
    const setupResponse = await setupFailure.handler(authorizedRequest());

    const dispatchFailure = createHarness();
    dispatchFailure.dispatch.mockRejectedValue(new Error(RAW_SENTINEL));
    const dispatchResponse = await dispatchFailure.handler(authorizedRequest());

    expect(gateResponse.status).toBe(503);
    expect(setupResponse.status).toBe(503);
    expect(dispatchResponse.status).toBe(503);
    expect(gateFailure.runWithLock).not.toHaveBeenCalled();
    expect(gateFailure.dispatch).not.toHaveBeenCalled();
    const bodies = `${await gateResponse.text()}${await setupResponse.text()}${await dispatchResponse.text()}`;
    expect(bodies).not.toContain(RAW_SENTINEL);
  });
});
