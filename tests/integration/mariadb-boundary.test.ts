import { describe, expect, it, vi } from "vitest";

import {
  parseDatabaseProbeEnvironment,
  parseReadinessBearerToken,
} from "@/platform/config/readiness-env.schema";
import { runMySqlSelectOneProbe } from "@/platform/database/mysql-readiness-core";
import { createConfiguredReadinessHandler } from "@/platform/health/configured-readiness";
import { isCorrelationId } from "@/platform/http/correlation-id";

const token = "FakeTokenValue01";
const correlationId = "11111111-1111-4111-8111-111111111111";
const validDatabaseInput = {
  DB_HOST: "localhost",
  DB_PORT: "3306",
  DB_NAME: "portal_probe",
  DB_USER: "portal_probe_user",
  DB_PASSWORD: "not-a-real-password",
};

type Query = Parameters<typeof runMySqlSelectOneProbe>[0];

function handlerFor(
  query: Query,
  databaseInput: Record<string, string | undefined> = validDatabaseInput,
  configuredToken = token,
) {
  return createConfiguredReadinessHandler({
    getBearerToken: () => parseReadinessBearerToken(configuredToken),
    getDatabaseEnvironment: () =>
      parseDatabaseProbeEnvironment(databaseInput),
    probeDatabase: () =>
      runMySqlSelectOneProbe(query, {
        queryTimeoutMs: 25,
        deadlineMs: 50,
      }),
  });
}

function readinessRequest(authorization?: string): Request {
  return new Request("http://localhost/api/internal/readiness", {
    headers: authorization
      ? {
          authorization,
          "x-correlation-id": correlationId,
        }
      : undefined,
  });
}

describe("configured MariaDB readiness boundary", () => {
  it.each([undefined, `Bearer ${"x".repeat(16)}`])(
    "returns a generic 404 without querying for missing or wrong auth",
    async (authorization) => {
      const query = vi.fn(async () => [[{ readiness_ok: 1 }], []]);
      const response = await handlerFor(query)(
        readinessRequest(authorization),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ status: "not_found" });
      expect(query).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );

  it.each([
    ["15 characters", "A".repeat(15)],
    ["17 characters", "A".repeat(17)],
    ["whitespace", `${"A".repeat(8)} ${"B".repeat(7)}`],
    ["Turkish character", `${"A".repeat(15)}Ş`],
    ["symbol", `${"A".repeat(15)}!`],
  ])(
    "fails closed before querying for configured token with %s",
    async (_case, configuredToken) => {
      const query = vi.fn(async () => [[{ readiness_ok: 1 }], []]);
      const response = await handlerFor(
        query,
        validDatabaseInput,
        configuredToken,
      )(readinessRequest(`Bearer ${token}`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ status: "not_found" });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("returns ready only for exact auth and a successful SELECT 1", async () => {
    const response = await handlerFor(async () => [
      [{ readiness_ok: 1 }],
      [],
    ])(readinessRequest(`Bearer ${token}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
  });

  it("returns generic unavailable for missing DB configuration", async () => {
    const incomplete: Record<string, string | undefined> = {
      ...validDatabaseInput,
    };
    delete incomplete.DB_NAME;
    const response = await handlerFor(
      async () => [[{ readiness_ok: 1 }], []],
      incomplete,
    )(readinessRequest(`Bearer ${token}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("contains no driver detail when the probe fails", async () => {
    const driverSentinel = "driver-error-and-password-sentinel";
    const response = await handlerFor(async () => {
      throw new Error(driverSentinel);
    })(readinessRequest(`Bearer ${token}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"status":"unavailable"}');
    expect(body).not.toContain(driverSentinel);
    expect(isCorrelationId(response.headers.get("x-correlation-id"))).toBe(
      true,
    );
  });
});
