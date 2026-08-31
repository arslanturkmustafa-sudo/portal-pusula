import "server-only";

import {
  parseCronEnvironment,
  type CronEnvironment,
} from "@/platform/config/cron-env.schema";

export function getCronEnvironment(): CronEnvironment {
  return parseCronEnvironment({
    CRON_BEARER_TOKEN: process.env.CRON_BEARER_TOKEN,
    CRON_ENDPOINT_ENABLED: process.env.CRON_ENDPOINT_ENABLED,
    CRON_MIN_INTERVAL_SECONDS: process.env.CRON_MIN_INTERVAL_SECONDS,
    READINESS_BEARER_TOKEN: process.env.READINESS_BEARER_TOKEN,
  });
}
