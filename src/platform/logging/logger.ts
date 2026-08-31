import "server-only";

import { getServerEnvironment } from "@/platform/config/server-env";
import { createAppLogger } from "@/platform/logging/logger-core.node";

const environment = getServerEnvironment();

export const appLogger = createAppLogger(environment.LOG_LEVEL);

export function requestLogger(correlationId: string) {
  return appLogger.child({ correlationId });
}

