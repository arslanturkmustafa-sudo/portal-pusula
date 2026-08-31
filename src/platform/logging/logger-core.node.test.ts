// @vitest-environment node

import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createAppLogger } from "@/platform/logging/logger-core.node";
import { toSafeError } from "@/platform/logging/safe-error";

async function capturePinoRecord(payload: Record<string, unknown>) {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = createAppLogger("info", destination);

  logger.info(payload, "structured event");

  await new Promise<void>((resolve) => setImmediate(resolve));
  const output = chunks.join("");

  return {
    output,
    record: JSON.parse(output.trim()) as Record<string, unknown>,
  };
}

describe("structured logging", () => {
  it("emits JSON while censoring sensitive and financial fields", async () => {
    const { output, record } = await capturePinoRecord({
      event: "redaction.checked",
      safeField: "safe-root-value",
      authorization: "Bearer top-secret-sentinel",
      cookie: "session=top-secret-cookie",
      finance: { amount: "9999.0000" },
      nested: {
        token: "oauth-token-sentinel",
        safeField: "safe-nested-value",
      },
      DB_PASSWORD: "database-password-sentinel",
      READINESS_BEARER_TOKEN: "readiness-token-sentinel",
    });

    expect(record.event).toBe("redaction.checked");
    expect(record.safeField).toBe("safe-root-value");
    expect(record.nested).toMatchObject({ safeField: "safe-nested-value" });
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("top-secret-sentinel");
    expect(output).not.toContain("top-secret-cookie");
    expect(output).not.toContain("9999.0000");
    expect(output).not.toContain("oauth-token-sentinel");
    expect(output).not.toContain("database-password-sentinel");
    expect(output).not.toContain("readiness-token-sentinel");
  });

  it("censors cron bearer tokens and authorization header variants", async () => {
    const sentinels = [
      "cron-environment-token-sentinel",
      "nested-cron-environment-token-sentinel",
      "root-bearer-token-sentinel",
      "nested-bearer-token-sentinel",
      "root-authorization-sentinel",
      "root-capitalized-authorization-sentinel",
      "nested-authorization-sentinel",
      "nested-capitalized-authorization-sentinel",
      "root-headers-authorization-sentinel",
      "root-headers-capitalized-authorization-sentinel",
      "request-headers-authorization-sentinel",
      "request-headers-capitalized-authorization-sentinel",
      "req-headers-authorization-sentinel",
      "req-headers-capitalized-authorization-sentinel",
      "root-header-authorization-sentinel",
      "root-header-capitalized-authorization-sentinel",
      "context-header-authorization-sentinel",
      "context-header-capitalized-authorization-sentinel",
    ] as const;

    const { output, record } = await capturePinoRecord({
      event: "cron.redaction.checked",
      safeField: "safe-root-value",
      CRON_BEARER_TOKEN: sentinels[0],
      bearerToken: sentinels[2],
      authorization: `Bearer ${sentinels[4]}`,
      Authorization: `Bearer ${sentinels[5]}`,
      headers: {
        authorization: `Bearer ${sentinels[8]}`,
        Authorization: `Bearer ${sentinels[9]}`,
        "x-correlation-id": "safe-root-correlation-id",
      },
      header: {
        authorization: `Bearer ${sentinels[14]}`,
        Authorization: `Bearer ${sentinels[15]}`,
        accept: "application/json",
      },
      nested: {
        CRON_BEARER_TOKEN: sentinels[1],
        bearerToken: sentinels[3],
        authorization: `Bearer ${sentinels[6]}`,
        Authorization: `Bearer ${sentinels[7]}`,
        safeField: "safe-nested-value",
      },
      request: {
        headers: {
          authorization: `Bearer ${sentinels[10]}`,
          Authorization: `Bearer ${sentinels[11]}`,
          accept: "application/json",
        },
        route: "/api/internal/cron/dispatch",
      },
      req: {
        headers: {
          authorization: `Bearer ${sentinels[12]}`,
          Authorization: `Bearer ${sentinels[13]}`,
          "user-agent": "safe-test-agent",
        },
      },
      context: {
        header: {
          authorization: `Bearer ${sentinels[16]}`,
          Authorization: `Bearer ${sentinels[17]}`,
          "x-operation": "safe-cron-dispatch",
        },
      },
    });

    for (const sentinel of sentinels) {
      expect(output).not.toContain(sentinel);
    }

    expect(output).not.toContain("sentinel");
    expect(output).toContain("[REDACTED]");
    expect(record).toMatchObject({
      event: "cron.redaction.checked",
      safeField: "safe-root-value",
      CRON_BEARER_TOKEN: "[REDACTED]",
      bearerToken: "[REDACTED]",
      authorization: "[REDACTED]",
      Authorization: "[REDACTED]",
    });
    expect(record.headers).toMatchObject({
      authorization: "[REDACTED]",
      Authorization: "[REDACTED]",
      "x-correlation-id": "safe-root-correlation-id",
    });
    expect(record.header).toMatchObject({
      authorization: "[REDACTED]",
      Authorization: "[REDACTED]",
      accept: "application/json",
    });
    expect(record.nested).toMatchObject({
      CRON_BEARER_TOKEN: "[REDACTED]",
      bearerToken: "[REDACTED]",
      authorization: "[REDACTED]",
      Authorization: "[REDACTED]",
      safeField: "safe-nested-value",
    });
    expect(record.request).toMatchObject({
      headers: {
        authorization: "[REDACTED]",
        Authorization: "[REDACTED]",
        accept: "application/json",
      },
      route: "/api/internal/cron/dispatch",
    });
    expect(record.req).toMatchObject({
      headers: {
        authorization: "[REDACTED]",
        Authorization: "[REDACTED]",
        "user-agent": "safe-test-agent",
      },
    });
    expect(record.context).toMatchObject({
      header: {
        authorization: "[REDACTED]",
        Authorization: "[REDACTED]",
        "x-operation": "safe-cron-dispatch",
      },
    });
  });

  it("keeps safe cron gate metadata while censoring raw gate errors", async () => {
    const rootSentinel = "raw-gate-database-error-sentinel";
    const nestedSentinel = "nested-gate-database-error-sentinel";
    const { output, record } = await capturePinoRecord({
      event: "cron.gate.checked",
      CRON_MIN_INTERVAL_SECONDS: "300",
      cronGateError: rootSentinel,
      gateDecision: "suppressed",
      gateKey: "platform-cron-dispatch",
      nested: {
        gateError: nestedSentinel,
        safeField: "safe-gate-metadata",
      },
    });

    expect(output).not.toContain(rootSentinel);
    expect(output).not.toContain(nestedSentinel);
    expect(record).toMatchObject({
      event: "cron.gate.checked",
      CRON_MIN_INTERVAL_SECONDS: "300",
      cronGateError: "[REDACTED]",
      gateDecision: "suppressed",
      gateKey: "platform-cron-dispatch",
      nested: {
        gateError: "[REDACTED]",
        safeField: "safe-gate-metadata",
      },
    });
  });

  it("does not expose unknown error messages or stacks", () => {
    const safe = toSafeError(new Error("database-url-and-token-sentinel"));

    expect(safe).toEqual({
      errorCode: "UNEXPECTED_ERROR",
      errorType: "Error",
    });
    expect(JSON.stringify(safe)).not.toContain("sentinel");
  });
});
