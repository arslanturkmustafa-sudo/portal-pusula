import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type UserNotificationSetting = Readonly<{
  createdAtUtc: string;
  recipientEmail: string;
  updatedAtUtc: string;
  userAccountId: string;
}>;

type UserNotificationSettingRow = RowDataPacket & {
  created_at_utc: string | Date;
  recipient_email: string;
  updated_at_utc: string | Date;
  user_account_id: string;
};

function canonicalDateTime(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().replace("T", " ").replace("Z", "000")
    : value;
}

function mapSetting(row: UserNotificationSettingRow): UserNotificationSetting {
  return {
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    recipientEmail: row.recipient_email,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    userAccountId: row.user_account_id,
  };
}

const COLUMNS = `
  user_account_id, recipient_email, created_at_utc, updated_at_utc`;

export async function findUserNotificationSetting(
  connection: PoolConnection,
  userAccountId: string,
): Promise<UserNotificationSetting | null> {
  const [rows] = await connection.execute<UserNotificationSettingRow[]>(
    `SELECT ${COLUMNS}
       FROM user_notification_setting
      WHERE user_account_id = ?
      LIMIT 1`,
    [userAccountId],
  );
  return rows[0] ? mapSetting(rows[0]) : null;
}

export async function findUserNotificationSettingForUpdate(
  connection: PoolConnection,
  userAccountId: string,
): Promise<UserNotificationSetting | null> {
  const [rows] = await connection.execute<UserNotificationSettingRow[]>(
    `SELECT ${COLUMNS}
       FROM user_notification_setting
      WHERE user_account_id = ?
      FOR UPDATE`,
    [userAccountId],
  );
  return rows[0] ? mapSetting(rows[0]) : null;
}

export async function upsertUserNotificationSetting(
  connection: PoolConnection,
  input: Readonly<{
    recipientEmail: string;
    updatedAtUtc: string;
    userAccountId: string;
  }>,
): Promise<UserNotificationSetting> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO user_notification_setting
       (user_account_id, recipient_email, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       recipient_email = ?, updated_at_utc = ?`,
    [
      input.userAccountId,
      input.recipientEmail,
      input.updatedAtUtc,
      input.updatedAtUtc,
      input.recipientEmail,
      input.updatedAtUtc,
    ],
  );
  const stored = await findUserNotificationSettingForUpdate(
    connection,
    input.userAccountId,
  );
  if (!stored) throw new Error("Notification settings upsert failed.");
  return stored;
}
