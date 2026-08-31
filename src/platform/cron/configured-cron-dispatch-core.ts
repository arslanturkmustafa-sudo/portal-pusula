import type { Pool } from "mysql2/promise";

import type { CronEnvironment } from "@/platform/config/cron-env.schema";
import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import {
  withCronAdvisoryLock,
  type CronAdvisoryLockRunner,
} from "@/platform/cron/cron-advisory-lock";
import type {
  AcquireCronDispatchPermitInput,
  CronDispatchGateDecision,
} from "@/platform/cron/cron-dispatch-gate-repository";
import {
  CRON_DISPATCH_GATE_KEY,
  createCronDispatchHandler,
  type CronDispatchRequest,
} from "@/platform/cron/cron-dispatch";

type ConfiguredCronDispatchDependencies = Readonly<{
  acquirePermit: (
    pool: Pool,
    input: AcquireCronDispatchPermitInput,
  ) => Promise<CronDispatchGateDecision>;
  dispatch: (pool: Pool, request: CronDispatchRequest) => Promise<unknown>;
  getDatabaseEnvironment: () => DatabaseProbeEnvironment;
  getEnvironment: () => CronEnvironment;
  getPool: (environment: DatabaseProbeEnvironment) => Pool;
  runWithLock?: CronAdvisoryLockRunner;
}>;

export function createConfiguredCronDispatchHandler({
  acquirePermit,
  dispatch,
  getDatabaseEnvironment,
  getEnvironment,
  getPool,
  runWithLock = withCronAdvisoryLock,
}: ConfiguredCronDispatchDependencies) {
  return createCronDispatchHandler({
    getEnvironment,
    async acquireGatePermit({ minimumIntervalSeconds }) {
      const databaseEnvironment = getDatabaseEnvironment();
      const pool = getPool(databaseEnvironment);

      return acquirePermit(pool, {
        gateKey: CRON_DISPATCH_GATE_KEY,
        minimumIntervalSeconds,
      });
    },
    async dispatch(request) {
      const databaseEnvironment = getDatabaseEnvironment();
      const pool = getPool(databaseEnvironment);

      await runWithLock(
        pool,
        databaseEnvironment.DB_NAME,
        request.signal,
        async () => {
          await dispatch(pool, request);
        },
      );
    },
  });
}
