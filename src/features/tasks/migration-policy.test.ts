import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("work task migration policy", () => {
  it("creates one forward-only Kanban task table with restrictive references", () => {
    const migration = readFileSync(
      resolve(root, "drizzle/0008_work_tasks.sql"),
      "utf8",
    );

    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `work_task`");
    expect(migration).toMatch(
      /ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci/iu,
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
    expect(migration).toContain("chk_work_task_status");
    expect(migration).toContain("chk_work_task_priority");
    expect(migration).toContain("chk_work_task_completion");
    expect(migration).toContain("chk_work_task_version");
    expect(migration.match(/ON DELETE restrict ON UPDATE restrict/gu)).toHaveLength(
      2,
    );
    expect(migration).toContain("fk_work_task_customer");
    expect(migration).toContain("fk_work_task_assignee");
    expect(migration).toContain("idx_work_task_board");
  });

  it("is journal entry 0008 and has a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 8,
      tag: "0008_work_tasks",
    });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0008_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("work_task");
  });
});
