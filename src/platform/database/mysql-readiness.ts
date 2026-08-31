import "server-only";

import { createPool, type Pool } from "mysql2/promise";

import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import { runMySqlSelectOneProbe } from "@/platform/database/mysql-readiness-core";

const MYSQL_CONNECT_TIMEOUT_MS = 2_000;
const MYSQL_IDLE_TIMEOUT_MS = 30_000;

let readinessPool: Pool | undefined;

function getReadinessPool(environment: DatabaseProbeEnvironment): Pool {
  readinessPool ??= createPool({
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    database: environment.DB_NAME,
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    charset: "utf8mb4",
    connectionLimit: 2,
    maxIdle: 2,
    idleTimeout: MYSQL_IDLE_TIMEOUT_MS,
    waitForConnections: false,
    connectTimeout: MYSQL_CONNECT_TIMEOUT_MS,
    enableKeepAlive: false,
    multipleStatements: false,
  });

  return readinessPool;
}

export async function probeMySqlReadiness(
  environment: DatabaseProbeEnvironment,
): Promise<boolean> {
  try {
    const pool = getReadinessPool(environment);
    return await runMySqlSelectOneProbe((options) => pool.query(options));
  } catch {
    return false;
  }
}
