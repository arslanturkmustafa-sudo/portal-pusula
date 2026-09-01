import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import {
  assertAppliedMigrationIntegrity,
  assertExpectedMigrationsUnchanged,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  migrationLockName,
  readExpectedMigrations,
} from "./migration-integrity.mjs";
import { applyMySqlSessionPolicy } from "./mysql-session-policy.mjs";

const MIGRATION_CONNECTION_LIMIT = 1;
const MIGRATION_CONNECT_TIMEOUT_MS = 5_000;
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

class MigrationConfigurationError extends Error {
  constructor(variableName) {
    super(`Migration configuration is invalid: ${variableName}.`);
    this.name = "MigrationConfigurationError";
  }
}

function optionalNonBlankEnvironment(variableName, fallback, maximumLength) {
  const value = process.env[variableName];

  if (value === undefined || value === "") {
    return fallback;
  }

  if (value.trim().length === 0 || value.length > maximumLength) {
    throw new MigrationConfigurationError(variableName);
  }

  return value;
}

function requiredNonBlankEnvironment(variableName, maximumLength) {
  const value = process.env[variableName];

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    throw new MigrationConfigurationError(variableName);
  }

  return value;
}

function databasePort() {
  const rawValue = process.env.DB_PORT;

  if (rawValue === undefined || rawValue === "") {
    return 3306;
  }

  if (!/^[0-9]{1,5}$/u.test(rawValue)) {
    throw new MigrationConfigurationError("DB_PORT");
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new MigrationConfigurationError("DB_PORT");
  }

  return value;
}

function migrationEnvironment() {
  return {
    host: optionalNonBlankEnvironment("DB_HOST", "localhost", 255),
    port: databasePort(),
    database: requiredNonBlankEnvironment("DB_NAME", 128),
    user: requiredNonBlankEnvironment("DB_USER", 128),
    password: requiredNonBlankEnvironment("DB_PASSWORD", 1024),
  };
}

class MigrationRuntimeError extends Error {
  constructor() {
    super("Database migration failed.");
    this.name = "MigrationRuntimeError";
  }
}

async function run() {
  const environment = migrationEnvironment();
  const pool = mysql.createPool({
    ...environment,
    charset: "utf8mb4",
    timezone: "Z",
    connectionLimit: MIGRATION_CONNECTION_LIMIT,
    maxIdle: MIGRATION_CONNECTION_LIMIT,
    waitForConnections: false,
    connectTimeout: MIGRATION_CONNECT_TIMEOUT_MS,
    enableKeepAlive: false,
    multipleStatements: false,
  });

  let connection;
  let lockAcquired = false;
  let sessionPolicyEstablished = false;
  let operationError;
  let cleanupFailed = false;
  let destroyConnection = false;
  const lockName = migrationLockName(environment.database);

  try {
    connection = await pool.getConnection();
    await applyMySqlSessionPolicy(connection, environment.database);
    sessionPolicyEstablished = true;

    const [lockRows] = await connection.query(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [lockName, MIGRATION_LOCK_TIMEOUT_SECONDS],
    );
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new MigrationRuntimeError();
    }
    lockAcquired = true;

    // Read the versioned set only while this database's migration lock is held.
    const expectedMigrations = await readExpectedMigrations(migrationsFolder);

    // Drizzle's MySQL migrator normally considers only the latest created_at.
    // Verify the full applied prefix and every SQL hash before it can run.
    await assertAppliedMigrationIntegrity(connection, expectedMigrations);

    const database = drizzle(connection, { logger: false });
    await migrate(database, { migrationsFolder });

    // A deploy must not be reported successful if its migration files changed
    // while Drizzle was applying them.
    const verifiedMigrations = await readExpectedMigrations(migrationsFolder);
    assertExpectedMigrationsUnchanged(expectedMigrations, verifiedMigrations);
    await assertAppliedMigrationIntegrity(connection, verifiedMigrations, {
      requireComplete: true,
    });
  } catch (error) {
    operationError = error;
    destroyConnection = true;
  } finally {
    if (connection && lockAcquired) {
      try {
        const [releaseRows] = await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          [lockName],
        );
        if (Number(releaseRows[0]?.released) !== 1) {
          cleanupFailed = true;
          destroyConnection = true;
        }
      } catch {
        cleanupFailed = true;
        destroyConnection = true;
      }
    }

    if (connection) {
      try {
        if (!sessionPolicyEstablished || destroyConnection) {
          connection.destroy();
        } else {
          connection.release();
        }
      } catch {
        cleanupFailed = true;
      }
    }

    try {
      await pool.end();
    } catch {
      cleanupFailed = true;
    }
  }

  if (operationError) {
    throw operationError;
  }

  if (cleanupFailed) {
    throw new MigrationRuntimeError();
  }

  console.info("Database migrations completed.");
}

try {
  await run();
} catch (error) {
  if (error instanceof MigrationConfigurationError) {
    console.error(error.message);
  } else {
    console.error("Database migration failed.");
  }

  process.exitCode = 1;
}
