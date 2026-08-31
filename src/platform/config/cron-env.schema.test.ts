import { describe, expect, it } from "vitest";

import {
  CronEnvironmentError,
  parseCronEnvironment,
} from "@/platform/config/cron-env.schema";

const cronToken = "A".repeat(43);

describe("cron environment schema", () => {
  it.each([undefined, "", "false"])(
    "defaults %j to a disabled endpoint",
    (enabled) => {
      expect(parseCronEnvironment({ CRON_ENDPOINT_ENABLED: enabled })).toEqual({
        enabled: false,
      });
    },
  );

  it("accepts only the exact enabled token contract", () => {
    expect(
      parseCronEnvironment({
        CRON_BEARER_TOKEN: cronToken,
        CRON_ENDPOINT_ENABLED: "true",
        CRON_MIN_INTERVAL_SECONDS: "60",
        READINESS_BEARER_TOKEN: "FakeTokenValue01",
      }),
    ).toEqual({
      bearerToken: cronToken,
      enabled: true,
      minimumIntervalSeconds: 60,
    });
  });

  it.each([
    ["minimum", "60", 60],
    ["representative", "300", 300],
    ["maximum", "86400", 86_400],
  ])("accepts the %s interval", (_case, value, expected) => {
    expect(
      parseCronEnvironment({
        CRON_BEARER_TOKEN: cronToken,
        CRON_ENDPOINT_ENABLED: "true",
        CRON_MIN_INTERVAL_SECONDS: value,
        READINESS_BEARER_TOKEN: "FakeTokenValue01",
      }),
    ).toMatchObject({ minimumIntervalSeconds: expected });
  });

  it.each([
    { CRON_ENDPOINT_ENABLED: "true" },
    { CRON_ENDPOINT_ENABLED: "TRUE" },
    {
      CRON_BEARER_TOKEN: "A".repeat(42),
      CRON_ENDPOINT_ENABLED: "true",
      CRON_MIN_INTERVAL_SECONDS: "60",
    },
    {
      CRON_BEARER_TOKEN: `${"A".repeat(42)}+`,
      CRON_ENDPOINT_ENABLED: "true",
      CRON_MIN_INTERVAL_SECONDS: "60",
    },
    {
      CRON_BEARER_TOKEN: cronToken,
      CRON_ENDPOINT_ENABLED: "true",
      CRON_MIN_INTERVAL_SECONDS: "60",
      READINESS_BEARER_TOKEN: cronToken,
    },
  ])("rejects an invalid enabled configuration", (input) => {
    expect(() => parseCronEnvironment(input)).toThrow(CronEnvironmentError);
  });

  it.each([
    undefined,
    "",
    "0",
    "59",
    "86401",
    "060",
    "+60",
    "60.0",
    "6e1",
    " 60",
    "60 ",
    "60\t",
    "６０",
  ])("rejects non-canonical or out-of-range interval %j", (interval) => {
    expect(() =>
      parseCronEnvironment({
        CRON_BEARER_TOKEN: cronToken,
        CRON_ENDPOINT_ENABLED: "true",
        CRON_MIN_INTERVAL_SECONDS: interval,
        READINESS_BEARER_TOKEN: "FakeTokenValue01",
      }),
    ).toThrow(CronEnvironmentError);
  });

  it("does not require cron secrets or interval while disabled", () => {
    expect(
      parseCronEnvironment({
        CRON_BEARER_TOKEN: "invalid",
        CRON_ENDPOINT_ENABLED: "false",
        CRON_MIN_INTERVAL_SECONDS: "invalid",
      }),
    ).toEqual({ enabled: false });
  });
});
