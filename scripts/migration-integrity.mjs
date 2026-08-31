import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

const migrationTagPattern = /^[0-9]{4}_[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export class MigrationIntegrityError extends Error {
  constructor() {
    super("Migration integrity verification failed.");
    this.name = "MigrationIntegrityError";
  }
}

function failIntegrity() {
  throw new MigrationIntegrityError();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readExpectedMigrations(migrationsFolder) {
  let journal;
  let directoryEntries;

  try {
    journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    );
    directoryEntries = await readdir(migrationsFolder, {
      withFileTypes: true,
    });
  } catch {
    failIntegrity();
  }

  if (!journal || !Array.isArray(journal.entries)) {
    failIntegrity();
  }

  const expectedSqlFiles = [];
  const expectedMigrations = [];
  const seenTags = new Set();
  const seenTimestamps = new Set();
  let previousTimestamp = -1;

  for (const [index, entry] of journal.entries.entries()) {
    if (
      !entry ||
      entry.idx !== index ||
      typeof entry.tag !== "string" ||
      !migrationTagPattern.test(entry.tag) ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= previousTimestamp ||
      seenTags.has(entry.tag) ||
      seenTimestamps.has(entry.when)
    ) {
      failIntegrity();
    }

    const sqlFileName = `${entry.tag}.sql`;
    let sql;
    try {
      sql = await readFile(join(migrationsFolder, sqlFileName), "utf8");
    } catch {
      failIntegrity();
    }

    if (sql.length === 0) {
      failIntegrity();
    }

    expectedSqlFiles.push(sqlFileName);
    expectedMigrations.push({
      createdAt: entry.when,
      hash: sha256(sql),
      sqlFileName,
    });
    seenTags.add(entry.tag);
    seenTimestamps.add(entry.when);
    previousTimestamp = entry.when;
  }

  const actualSqlFiles = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (
    actualSqlFiles.length !== expectedSqlFiles.length ||
    actualSqlFiles.some((fileName, index) => fileName !== expectedSqlFiles[index])
  ) {
    failIntegrity();
  }

  return expectedMigrations;
}

export function assertExpectedMigrationsUnchanged(before, after) {
  if (
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    before.length !== after.length ||
    before.some(
      (migration, index) =>
        migration.createdAt !== after[index]?.createdAt ||
        migration.hash !== after[index]?.hash ||
        migration.sqlFileName !== after[index]?.sqlFileName,
    )
  ) {
    failIntegrity();
  }
}

async function readAppliedMigrations(connection) {
  const [tableRows] = await connection.execute(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [DRIZZLE_MIGRATIONS_TABLE],
  );

  if (Number(tableRows[0]?.table_count) === 0) {
    return [];
  }

  if (Number(tableRows[0]?.table_count) !== 1) {
    failIntegrity();
  }

  const [migrationRows] = await connection.query(
    `SELECT id, hash, created_at
       FROM \`${DRIZZLE_MIGRATIONS_TABLE}\`
      ORDER BY id ASC`,
  );

  return migrationRows;
}

export async function assertAppliedMigrationIntegrity(
  connection,
  expectedMigrations,
  { requireComplete = false } = {},
) {
  let appliedMigrations;
  try {
    appliedMigrations = await readAppliedMigrations(connection);
  } catch (error) {
    if (error instanceof MigrationIntegrityError) {
      throw error;
    }
    failIntegrity();
  }

  if (
    !Array.isArray(appliedMigrations) ||
    appliedMigrations.length > expectedMigrations.length ||
    (requireComplete && appliedMigrations.length !== expectedMigrations.length)
  ) {
    failIntegrity();
  }

  for (const [index, applied] of appliedMigrations.entries()) {
    const expected = expectedMigrations[index];
    if (
      !expected ||
      Number(applied.id) !== index + 1 ||
      typeof applied.hash !== "string" ||
      applied.hash !== expected.hash ||
      Number(applied.created_at) !== expected.createdAt
    ) {
      failIntegrity();
    }
  }
}
