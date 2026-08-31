import "server-only";

import type { Pool, PoolConnection } from "mysql2/promise";

export async function withUtcTransaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();

  try {
    await connection.query("SET SESSION time_zone = '+00:00'");
    // READ COMMITTED avoids broad next-key/gap locks around bounded claim
    // scans while FOR UPDATE still provides row ownership and fencing.
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // The original operation error remains authoritative and is never logged.
    }
    throw error;
  } finally {
    connection.release();
  }
}
