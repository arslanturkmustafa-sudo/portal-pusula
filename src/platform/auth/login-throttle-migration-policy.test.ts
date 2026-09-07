import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0013_login_attempt_throttle.sql"),
  "utf8",
);

describe("persistent login throttle migration policy", () => {
  it("stores only pseudonymous bucket state with bounded lifecycle indexes", () => {
    expect(migration).toContain("CREATE TABLE `login_attempt_throttle`");
    expect(migration).toMatch(
      /`bucket_key` char\(64\) CHARACTER SET ascii COLLATE ascii_bin/u,
    );
    expect(migration).toMatch(
      /`bucket_type` varchar\(16\) CHARACTER SET ascii COLLATE ascii_bin/u,
    );
    expect(migration).toContain("BINARY 'account'");
    expect(migration).toContain("BINARY 'global'");
    expect(migration).toContain("BINARY 'network'");
    expect(migration).toContain("idx_login_attempt_throttle_updated");
    expect(migration).toContain("idx_login_attempt_throttle_blocked");
    expect(migration).not.toMatch(/`(?:email|ip|password|secret|token)`/iu);
  });

  it("keeps journal entry 0013 with a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual(
      expect.objectContaining({
      idx: 13,
      tag: "0013_login_attempt_throttle",
      }),
    );

    const snapshot = JSON.parse(
      readFileSync(
        resolve(root, "drizzle/meta/0013_snapshot.json"),
        "utf8",
      ),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("login_attempt_throttle");
  });
});
