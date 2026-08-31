import "server-only";

import {
  parseServerEnvironment,
  type ServerEnvironment,
} from "@/platform/config/server-env.schema";

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment({
    LOG_LEVEL: process.env.LOG_LEVEL,
  });

  return cachedEnvironment;
}

