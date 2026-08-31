import { z } from "zod";

const cronTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/u);

export const CRON_MIN_INTERVAL_SECONDS_MIN = 60;
export const CRON_MIN_INTERVAL_SECONDS_MAX = 86_400;

const canonicalIntegerSchema = z.string().regex(/^[1-9][0-9]*$/u);

export type DisabledCronEnvironment = {
  enabled: false;
};

export type EnabledCronEnvironment = {
  bearerToken: string;
  enabled: true;
  minimumIntervalSeconds: number;
};

export type CronEnvironment =
  | DisabledCronEnvironment
  | EnabledCronEnvironment;

export class CronEnvironmentError extends Error {
  constructor() {
    super("Cron environment configuration is invalid.");
    this.name = "CronEnvironmentError";
  }
}

export function parseCronEnvironment(
  input: Record<string, string | undefined>,
): CronEnvironment {
  const enabledValue = input.CRON_ENDPOINT_ENABLED;
  if (
    enabledValue === undefined ||
    enabledValue === "" ||
    enabledValue === "false"
  ) {
    return { enabled: false };
  }

  if (enabledValue !== "true") {
    throw new CronEnvironmentError();
  }

  const cronToken = cronTokenSchema.safeParse(input.CRON_BEARER_TOKEN);
  const minimumInterval = canonicalIntegerSchema.safeParse(
    input.CRON_MIN_INTERVAL_SECONDS,
  );
  const minimumIntervalSeconds = minimumInterval.success
    ? Number(minimumInterval.data)
    : Number.NaN;
  if (
    !cronToken.success ||
    !minimumInterval.success ||
    !Number.isSafeInteger(minimumIntervalSeconds) ||
    minimumIntervalSeconds < CRON_MIN_INTERVAL_SECONDS_MIN ||
    minimumIntervalSeconds > CRON_MIN_INTERVAL_SECONDS_MAX ||
    typeof input.READINESS_BEARER_TOKEN !== "string" ||
    input.READINESS_BEARER_TOKEN.length === 0 ||
    cronToken.data === input.READINESS_BEARER_TOKEN
  ) {
    throw new CronEnvironmentError();
  }

  return {
    bearerToken: cronToken.data,
    enabled: true,
    minimumIntervalSeconds,
  };
}
