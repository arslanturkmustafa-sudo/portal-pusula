import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getEmailEnvironment } from "@/platform/config/email-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { defaultBackoffPolicy } from "@/platform/jobs/backoff";
import { systemClock } from "@/platform/jobs/time";
import { requestLogger } from "@/platform/logging/logger";
import {
  dispatchOutboxBatch,
  productionOutboxAdapterRegistry,
} from "@/platform/outbox";

export function scheduleEmailOutboxDispatch(correlationId: string): void {
  after(async () => {
    try {
      if (!getEmailEnvironment().enabled) return;
      await dispatchOutboxBatch(
        getPlatformDatabasePool(getDatabaseProbeEnvironment()),
        {
          adapters: productionOutboxAdapterRegistry,
          backoffPolicy: defaultBackoffPolicy,
          batchSize: 1,
          clock: systemClock,
          leaseDurationMs: 30_000,
          leaseOwner: `email:${randomUUID()}`,
        },
      );
    } catch {
      requestLogger(correlationId).warn(
        { event: "email.outbox.dispatch_failed" },
        "Email outbox dispatch failed safely.",
      );
    }
  });
}
