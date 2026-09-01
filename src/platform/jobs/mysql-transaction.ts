import "server-only";

import type { Pool, PoolConnection } from "mysql2/promise";

import {
  configureAndVerifyMySqlSession,
  registeredMySqlPoolDatabase,
} from "@/platform/database/mysql-session-contract";

export async function withUtcTransaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const expectedDatabaseName = registeredMySqlPoolDatabase(pool);
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await configureAndVerifyMySqlSession(connection, expectedDatabaseName);
    // READ COMMITTED avoids broad next-key/gap locks around bounded claim
    // scans while FOR UPDATE still provides row ownership and fencing.
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await operation(connection);
    await connection.commit();
    transactionStarted = false;
    connection.release();
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // The original error remains authoritative and is never logged.
      }
    }
    try {
      connection.destroy();
    } catch {
      // The connection remains excluded from the reusable release path.
    }
    throw error;
  }
}
