import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0007_user_account.sql"),
  "utf8",
);

describe("user account migration policy", () => {
  it("adds one forward-only credential table without embedding an account", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `user_account`");
    expect(migration).toMatch(
      /ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci/iu,
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
  });

  it("pins exact credential, identity and version storage", () => {
    expect(migration).toMatch(
      /`id` char\(36\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/iu,
    );
    expect(migration).toMatch(
      /`password_hash` varchar\(191\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/iu,
    );
    expect(migration).toContain("chk_user_account_password_hash");
    expect(migration).toContain("credential_version");
    expect(migration).toContain("uq_user_account_email");
  });

  it("is journal entry 0007 and has a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find((entry) => entry.tag === "0007_user_account"),
    ).toMatchObject({
      idx: 7,
      tag: "0007_user_account",
    });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0007_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("user_account");
  });
});
