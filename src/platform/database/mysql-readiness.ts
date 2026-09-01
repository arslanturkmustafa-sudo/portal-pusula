import "server-only";

import { createPool, type Pool, type PoolConnection } from "mysql2/promise";

import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import {
  MYSQL_PROBE_DEADLINE_MS,
  runMySqlSelectOneProbe,
} from "@/platform/database/mysql-readiness-core";
import { configureAndVerifyMySqlSession } from "@/platform/database/mysql-session-contract";

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
    return await probeMySqlReadinessUsingPool(
      getReadinessPool(environment),
      environment,
    );
  } catch {
    return false;
  }
}

export async function probeMySqlReadinessUsingPool(
  pool: Pick<Pool, "getConnection">,
  environment: DatabaseProbeEnvironment,
  timing: { deadlineMs?: number } = {},
): Promise<boolean> {
  let connection: PoolConnection | undefined;
  let deadlineExceeded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        deadlineExceeded = true;
        resolve(false);
      }, timing.deadlineMs ?? MYSQL_PROBE_DEADLINE_MS);
      timer.unref?.();
    });
    const readinessAttempt = Promise.resolve().then(async () => {
      const acquiredConnection = await pool.getConnection();
      if (deadlineExceeded) {
        acquiredConnection.destroy();
        return false;
      }
      connection = acquiredConnection;
      try {
        await configureAndVerifyMySqlSession(
          acquiredConnection,
          environment.DB_NAME,
        );
        if (deadlineExceeded) return false;
        return runMySqlSelectOneProbe((options) =>
          acquiredConnection.query(options),
        );
      } catch {
        return false;
      }
    });
    const ready = await Promise.race([readinessAttempt, deadline]);
    if (!ready || !connection) {
      connection?.destroy();
      connection = undefined;
      return false;
    }

    connection.release();
    connection = undefined;
    return true;
  } catch {
    if (connection) {
      try {
        connection.destroy();
      } catch {
        // Readiness remains a generic fail-closed false result.
      }
    }
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
