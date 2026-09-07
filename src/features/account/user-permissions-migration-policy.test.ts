import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "drizzle/0012_user_permissions.sql"), "utf8");

describe("user permission migration policy", () => {
  it("atomically backfills existing accounts as owners before defaulting new accounts to member", () => {
    expect(migration).toMatch(/ADD `role`[\s\S]*DEFAULT 'owner'/u);
    expect(migration).toMatch(/MODIFY `role`[\s\S]*DEFAULT 'member'/u);
    expect(migration.indexOf("DEFAULT 'owner'")).toBeLessThan(migration.indexOf("DEFAULT 'member'"));
  });

  it("uses exact identities, restrictive ownership and an allowlisted permission check", () => {
    expect(migration).toContain("CREATE TABLE `user_permission`");
    expect(migration).toMatch(/`user_account_id` char\(36\) CHARACTER SET ascii COLLATE ascii_bin/u);
    expect(migration).toMatch(/`permission_code` varchar\(64\) CHARACTER SET ascii COLLATE ascii_bin/u);
    expect(migration).toContain("ON DELETE restrict ON UPDATE restrict");
    expect(migration).toContain("BINARY 'finance.receivables.read'");
    expect(migration).toContain("BINARY 'tasks.reports.export'");
  });

  it("is journal entry 0012 with a generated snapshot", () => {
    const journal = JSON.parse(readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries[12]).toMatchObject({
      idx: 12,
      tag: "0012_user_permissions",
    });
    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0012_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("user_account");
    expect(snapshot.tables).toHaveProperty("user_permission");
  });
});
