import "server-only";

import { createPool, type Pool } from "mysql2/promise";

import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";

const PLATFORM_CONNECT_TIMEOUT_MS = 2_000;
const PLATFORM_IDLE_TIMEOUT_MS = 30_000;

let platformPool: Pool | undefined;

/**
 * The job/outbox candidate shares one deliberately small server-only pool.
 * The advisory lock occupies one connection while bounded work uses the other.
 */
export function getPlatformDatabasePool(
  environment: DatabaseProbeEnvironment,
): Pool {
  platformPool ??= createPool({
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    database: environment.DB_NAME,
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    charset: "utf8mb4",
    timezone: "Z",
    connectionLimit: 2,
    maxIdle: 2,
    idleTimeout: PLATFORM_IDLE_TIMEOUT_MS,
    waitForConnections: false,
    connectTimeout: PLATFORM_CONNECT_TIMEOUT_MS,
    enableKeepAlive: false,
    multipleStatements: false,
  });

  return platformPool;
}
