import "server-only";

import {
  parseDatabaseProbeEnvironment,
  parseReadinessBearerToken,
  type DatabaseProbeEnvironment,
} from "@/platform/config/readiness-env.schema";

export function getReadinessBearerToken(): string {
  return parseReadinessBearerToken(process.env.READINESS_BEARER_TOKEN);
}

export function getDatabaseProbeEnvironment(): DatabaseProbeEnvironment {
  return parseDatabaseProbeEnvironment({
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
  });
}
