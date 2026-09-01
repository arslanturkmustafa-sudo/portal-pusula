import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type UserAccountStatus = "active" | "disabled";

export type UserAccount = Readonly<{
  createdAtUtc: string;
  credentialVersion: number;
  email: string;
  id: string;
  passwordChangedAtUtc: string;
  passwordHash: string;
  status: UserAccountStatus;
  updatedAtUtc: string;
}>;

type UserAccountRow = RowDataPacket & {
  created_at_utc: string | Date;
  credential_version: number;
  email: string;
  id: string;
  password_changed_at_utc: string | Date;
  password_hash: string;
  status: string;
  updated_at_utc: string | Date;
};

type CountRow = RowDataPacket & { row_count: number | string };

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function mapUserAccount(row: UserAccountRow): UserAccount {
  if (row.status !== "active" && row.status !== "disabled") {
    throw new Error("User account status is invalid.");
  }
  if (!Number.isSafeInteger(row.credential_version) || row.credential_version < 1) {
    throw new Error("User account credential version is invalid.");
  }

  return {
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    credentialVersion: row.credential_version,
    email: row.email,
    id: row.id,
    passwordChangedAtUtc: canonicalDateTime(row.password_changed_at_utc),
    passwordHash: row.password_hash,
    status: row.status,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
  };
}

const USER_ACCOUNT_COLUMNS = `
  id, email, password_hash, credential_version, status,
  password_changed_at_utc, created_at_utc, updated_at_utc`;

export async function countUserAccounts(
  connection: PoolConnection,
): Promise<number> {
  const [rows] = await connection.execute<CountRow[]>(
    "SELECT COUNT(*) AS row_count FROM user_account",
  );
  const count = Number(rows[0]?.row_count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("User account count is invalid.");
  }
  return count;
}

export async function findUserAccountByEmail(
  connection: PoolConnection,
  email: string,
): Promise<UserAccount | null> {
  const [rows] = await connection.execute<UserAccountRow[]>(
    `SELECT ${USER_ACCOUNT_COLUMNS}
       FROM user_account
      WHERE email = ?
      LIMIT 1`,
    [email],
  );
  return rows[0] ? mapUserAccount(rows[0]) : null;
}

export async function findUserAccountById(
  connection: PoolConnection,
  id: string,
): Promise<UserAccount | null> {
  const [rows] = await connection.execute<UserAccountRow[]>(
    `SELECT ${USER_ACCOUNT_COLUMNS}
       FROM user_account
      WHERE id = ?
      LIMIT 1`,
    [id],
  );
  return rows[0] ? mapUserAccount(rows[0]) : null;
}

export async function findUserAccountForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<UserAccount | null> {
  const [rows] = await connection.execute<UserAccountRow[]>(
    `SELECT ${USER_ACCOUNT_COLUMNS}
       FROM user_account
      WHERE id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapUserAccount(rows[0]) : null;
}

export async function insertUserAccount(
  connection: PoolConnection,
  account: UserAccount,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO user_account
       (id, email, password_hash, credential_version, status,
        password_changed_at_utc, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      account.email,
      account.passwordHash,
      account.credentialVersion,
      account.status,
      account.passwordChangedAtUtc,
      account.createdAtUtc,
      account.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) {
    throw new Error("User account insert failed.");
  }
}

export async function updateUserAccountPassword(
  connection: PoolConnection,
  input: Readonly<{
    credentialVersion: number;
    expectedCredentialVersion: number;
    id: string;
    passwordChangedAtUtc: string;
    passwordHash: string;
    updatedAtUtc: string;
  }>,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE user_account
        SET password_hash = ?, credential_version = ?,
            password_changed_at_utc = ?, updated_at_utc = ?
      WHERE id = ? AND credential_version = ? AND status = 'active'`,
    [
      input.passwordHash,
      input.credentialVersion,
      input.passwordChangedAtUtc,
      input.updatedAtUtc,
      input.id,
      input.expectedCredentialVersion,
    ],
  );
  return result.affectedRows === 1;
}
