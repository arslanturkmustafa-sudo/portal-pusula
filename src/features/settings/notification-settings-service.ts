import "server-only";

import type { Pool } from "mysql2/promise";

import {
  findUserNotificationSetting,
  findUserNotificationSettingForUpdate,
  upsertUserNotificationSetting,
} from "./notification-settings-repository";
import {
  type UpdateNotificationSettingsInput,
  updateNotificationSettingsInputSchema,
} from "./notification-settings-validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import {
  withUtcConsistentRead,
  withUtcTransaction,
} from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export type NotificationSettingsView = Readonly<{
  recipientEmail: string;
  usesAccountEmail: boolean;
}>;

export type NotificationSettingsWriteContext = Readonly<{
  actorId: string;
  correlationId: string;
  now?: Date;
}>;

export async function getNotificationSettings(
  pool: Pool,
  userAccountId: string,
  accountEmail: string,
): Promise<NotificationSettingsView> {
  assertCanonicalUuid(userAccountId);
  return withUtcConsistentRead(pool, async (connection) => {
    const setting = await findUserNotificationSetting(connection, userAccountId);
    return setting
      ? { recipientEmail: setting.recipientEmail, usesAccountEmail: false }
      : { recipientEmail: accountEmail, usesAccountEmail: true };
  });
}

export async function updateNotificationSettings(
  pool: Pool,
  userAccountId: string,
  rawInput: UpdateNotificationSettingsInput,
  context: NotificationSettingsWriteContext,
): Promise<NotificationSettingsView> {
  assertCanonicalUuid(userAccountId);
  assertCanonicalUuid(context.actorId);
  const input = updateNotificationSettingsInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findUserNotificationSettingForUpdate(
      connection,
      userAccountId,
    );
    const after = await upsertUserNotificationSetting(connection, {
      recipientEmail: input.recipientEmail,
      updatedAtUtc: now,
      userAccountId,
    });
    await appendAuditEvent(connection, {
      action: "notification_settings.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: { recipientEmail: after.recipientEmail },
      beforeSummary: before
        ? { recipientEmail: before.recipientEmail }
        : undefined,
      correlationId: context.correlationId,
      entityId: userAccountId,
      entityType: "user_notification_setting",
      occurredAtUtc: now,
    });
    return { recipientEmail: after.recipientEmail, usesAccountEmail: false };
  });
}
