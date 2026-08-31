import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { parseCronEnvironment } from "@/platform/config/cron-env.schema";
import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import type { CronAdvisoryLockRunner } from "@/platform/cron/cron-advisory-lock";
import { createConfiguredCronDispatchHandler } from "@/platform/cron/configured-cron-dispatch-core";
import { CRON_DISPATCH_GATE_KEY } from "@/platform/cron/cron-dispatch";

const CRON_TOKEN = "Z".repeat(43);
const READINESS_TOKEN = "FakeTokenValue01";
const DATABASE_ENVIRONMENT: DatabaseProbeEnvironment = {
  DB_HOST: "localhost",
  DB_PORT: 3306,
  DB_NAME: "local_cron_boundary",
  DB_USER: "local_user",
  DB_PASSWORD: "not-a-real-password",
};

function cronEnvironment(enabled = "true") {
  return parseCronEnvironment({
    CRON_BEARER_TOKEN: CRON_TOKEN,
    CRON_ENDPOINT_ENABLED: enabled,
    CRON_MIN_INTERVAL_SECONDS: "300",
    READINESS_BEARER_TOKEN: READINESS_TOKEN,
  });
}

function createHarness(decision: "permit" | "suppressed" = "permit") {
  const pool = {} as Pool;
  const acquirePermit = vi.fn().mockResolvedValue(decision);
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const getDatabaseEnvironment = vi
    .fn()
    .mockReturnValue(DATABASE_ENVIRONMENT);
  const getPool = vi.fn().mockReturnValue(pool);
  const runWithLock = vi.fn<CronAdvisoryLockRunner>(
    async (
      _pool: Pick<Pool, "getConnection">,
      _databaseName: string,
      _signal: AbortSignal,
      operation: () => Promise<void>,
    ) => {
      await operation();
      return true;
    },
  );
  const handler = createConfiguredCronDispatchHandler({
    acquirePermit,
    dispatch,
    getDatabaseEnvironment,
    getEnvironment: () => cronEnvironment(),
    getPool,
    runWithLock,
  });

  return {
    acquirePermit,
    dispatch,
    getDatabaseEnvironment,
    getPool,
    handler,
    pool,
    runWithLock,
  };
}

function authorizedRequest(): Request {
  return new Request("http://localhost/api/internal/cron/dispatch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${CRON_TOKEN}`,
      "x-correlation-id": "11111111-1111-4111-8111-111111111111",
    },
  });
}

describe("configured durable cron boundary without a live database", () => {
  it("passes exact parsed interval to the gate before lock and dispatch", async () => {
    const harness = createHarness();

    const response = await harness.handler(authorizedRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(harness.acquirePermit).toHaveBeenCalledExactlyOnceWith(
      harness.pool,
      {
        gateKey: CRON_DISPATCH_GATE_KEY,
        minimumIntervalSeconds: 300,
      },
    );
    expect(harness.dispatch).toHaveBeenCalledOnce();
    expect(
      harness.acquirePermit.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.runWithLock.mock.invocationCallOrder[0] ?? 0);
  });

  it("uses the same 202 contract for suppression without locking or dispatching", async () => {
    const harness = createHarness("suppressed");

    const response = await harness.handler(authorizedRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(harness.acquirePermit).toHaveBeenCalledOnce();
    expect(harness.runWithLock).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["wrong", `Bearer ${CRON_TOKEN}x`],
  ])("does not resolve DB or gate for %s authorization", async (_case, auth) => {
    const harness = createHarness();
    const response = await harness.handler(
      new Request("http://localhost/api/internal/cron/dispatch", {
        method: "POST",
        headers: auth === undefined ? undefined : { authorization: auth },
      }),
    );

    expect(response.status).toBe(404);
    expect(harness.getDatabaseEnvironment).not.toHaveBeenCalled();
    expect(harness.getPool).not.toHaveBeenCalled();
    expect(harness.acquirePermit).not.toHaveBeenCalled();
    expect(harness.runWithLock).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("fails closed without leaking a gate database error", async () => {
    const harness = createHarness();
    const sentinel = "RAW_GATE_DATABASE_AND_PASSWORD_SENTINEL";
    harness.acquirePermit.mockRejectedValue(new Error(sentinel));

    const response = await harness.handler(authorizedRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"status":"unavailable"}');
    expect(body).not.toContain(sentinel);
    expect(harness.runWithLock).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });
});
