import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0021_user_notification_settings.sql"),
  "utf8",
);

describe("user notification settings migration policy", () => {
  it("adds one restrictive owner-linked settings table", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `user_notification_setting`");
    expect(migration).toContain(
      "`user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    );
    expect(migration).toContain("chk_user_notification_setting_email");
    expect(migration).toContain("fk_user_notification_setting_account");
    expect(migration).toContain("ON DELETE restrict ON UPDATE restrict");
    expect(migration).toContain(
      "ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
  });

  it("is journal entry 0021 with a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0021_user_notification_settings",
      ),
    ).toMatchObject({ idx: 21, tag: "0021_user_notification_settings" });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0021_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("user_notification_setting");
  });
});
