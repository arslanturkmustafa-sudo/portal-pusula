import "server-only";

import { getCronEnvironment } from "@/platform/config/cron-env";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { createConfiguredCronDispatchHandler } from "@/platform/cron/configured-cron-dispatch-core";
import { acquireCronDispatchPermit } from "@/platform/cron/cron-dispatch-gate-repository";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { dispatchPlatformWork } from "@/platform/jobs";

export const configuredCronDispatchHandler =
  createConfiguredCronDispatchHandler({
    acquirePermit: acquireCronDispatchPermit,
    dispatch: dispatchPlatformWork,
    getDatabaseEnvironment: getDatabaseProbeEnvironment,
    getEnvironment: getCronEnvironment,
    getPool: getPlatformDatabasePool,
  });
