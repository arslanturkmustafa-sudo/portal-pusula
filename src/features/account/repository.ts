import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  isPermissionCode,
  type AccountRole,
  type PermissionCode,
} from "@/platform/auth/permissions";

export type UserAccountStatus = "active" | "disabled";

export type UserAccount = Readonly<{
  createdAtUtc: string;
  credentialVersion: number;
  displayName: string;
  email: string;
  id: string;
  passwordChangedAtUtc: string;
  passwordHash: string;
  role: AccountRole;
  status: UserAccountStatus;
  updatedAtUtc: string;
}>;

type UserAccountRow = RowDataPacket & {
  created_at_utc: string | Date;
  credential_version: number;
  display_name: string;
  email: string;
  id: string;
  password_changed_at_utc: string | Date;
  password_hash: string;
  role: string;
  status: string;
  updated_at_utc: string | Date;
};

type UserPermissionRow = RowDataPacket & {
  permission_code: string;
};

type UserPermissionWithAccountRow = UserPermissionRow & {
  user_account_id: string;
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
  if (row.role !== "owner" && row.role !== "member") {
    throw new Error("User account role is invalid.");
  }
  if (row.display_name.trim() !== row.display_name || row.display_name.length < 1) {
    throw new Error("User account display name is invalid.");
  }

  return {
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    credentialVersion: row.credential_version,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    passwordChangedAtUtc: canonicalDateTime(row.password_changed_at_utc),
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
  };
}

const USER_ACCOUNT_COLUMNS = `
  id, email, display_name, password_hash, credential_version, role, status,
  password_changed_at_utc, created_at_utc, updated_at_utc`;

export async function listUserPermissionCodes(
  connection: PoolConnection,
  userAccountId: string,
): Promise<readonly PermissionCode[]> {
  const [rows] = await connection.execute<UserPermissionRow[]>(
    `SELECT permission_code
       FROM user_permission
      WHERE user_account_id = ?
      ORDER BY permission_code ASC`,
    [userAccountId],
  );
  return rows.map((row) => {
    if (!isPermissionCode(row.permission_code)) {
      throw new Error("User permission code is invalid.");
    }
    return row.permission_code;
  });
}

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

export async function listUserAccounts(
  connection: PoolConnection,
): Promise<readonly UserAccount[]> {
  const [rows] = await connection.execute<UserAccountRow[]>(
    `SELECT ${USER_ACCOUNT_COLUMNS}
       FROM user_account
      ORDER BY role = 'owner' DESC, status = 'active' DESC,
               display_name ASC, id ASC`,
  );
  return rows.map(mapUserAccount);
}

export async function listAllUserPermissions(
  connection: PoolConnection,
): Promise<ReadonlyMap<string, readonly PermissionCode[]>> {
  const [rows] = await connection.execute<UserPermissionWithAccountRow[]>(
    `SELECT user_account_id, permission_code
       FROM user_permission
      ORDER BY user_account_id ASC, permission_code ASC`,
  );
  const result = new Map<string, PermissionCode[]>();
  for (const row of rows) {
    if (!isPermissionCode(row.permission_code)) {
      throw new Error("User permission code is invalid.");
    }
    const current = result.get(row.user_account_id) ?? [];
    current.push(row.permission_code);
    result.set(row.user_account_id, current);
  }
  return result;
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
       (id, email, display_name, password_hash, credential_version, role, status,
        password_changed_at_utc, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.passwordHash,
      account.credentialVersion,
      account.role,
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

export async function replaceUserPermissions(
  connection: PoolConnection,
  userAccountId: string,
  permissions: readonly PermissionCode[],
  createdAtUtc: string,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    "DELETE FROM user_permission WHERE user_account_id = ?",
    [userAccountId],
  );
  for (const permission of permissions) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO user_permission
         (user_account_id, permission_code, created_at_utc)
       VALUES (?, ?, ?)`,
      [userAccountId, permission, createdAtUtc],
    );
    if (result.affectedRows !== 1) {
      throw new Error("User permission insert failed.");
    }
  }
}

export async function updateUserAccountStatus(
  connection: PoolConnection,
  input: Readonly<{
    credentialVersion: number;
    expectedCredentialVersion: number;
    id: string;
    status: UserAccountStatus;
    updatedAtUtc: string;
  }>,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE user_account
        SET status = ?, credential_version = ?, updated_at_utc = ?
      WHERE id = ? AND credential_version = ? AND role = 'member'`,
    [
      input.status,
      input.credentialVersion,
      input.updatedAtUtc,
      input.id,
      input.expectedCredentialVersion,
    ],
  );
  return result.affectedRows === 1;
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
