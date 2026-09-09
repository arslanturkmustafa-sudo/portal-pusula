// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  find: vi.fn(),
  findForUpdate: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("./notification-settings-repository", () => ({
  findUserNotificationSetting: mocks.find,
  findUserNotificationSettingForUpdate: mocks.findForUpdate,
  upsertUserNotificationSetting: mocks.upsert,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcConsistentRead: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  getNotificationSettings,
  updateNotificationSettings,
} from "./notification-settings-service";

const accountId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-10T06:00:00.000Z");

describe("notification settings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue(null);
    mocks.findForUpdate.mockResolvedValue(null);
    mocks.upsert.mockImplementation(async (_connection, input) => ({
      createdAtUtc: input.updatedAtUtc,
      recipientEmail: input.recipientEmail,
      updatedAtUtc: input.updatedAtUtc,
      userAccountId: input.userAccountId,
    }));
  });

  it("falls back to the account email until an override is saved", async () => {
    await expect(
      getNotificationSettings({} as Pool, accountId, "owner@example.com"),
    ).resolves.toEqual({
      recipientEmail: "owner@example.com",
      usesAccountEmail: true,
    });
  });

  it("normalizes and audits an independent recipient address", async () => {
    await expect(
      updateNotificationSettings(
        {} as Pool,
        accountId,
        { recipientEmail: "  Bildirim@Example.COM  " },
        { actorId: accountId, correlationId: "settings-test", now },
      ),
    ).resolves.toEqual({
      recipientEmail: "bildirim@example.com",
      usesAccountEmail: false,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        recipientEmail: "bildirim@example.com",
        userAccountId: accountId,
      }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "notification_settings.updated",
        actorId: accountId,
        entityId: accountId,
        entityType: "user_notification_setting",
      }),
    );
  });
});
