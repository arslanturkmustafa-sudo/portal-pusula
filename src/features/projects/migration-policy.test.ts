import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("project migration policy", () => {
  it("adds the project portfolio and one-project-per-task link forward only", () => {
    const migration = readFileSync(
      resolve(root, "drizzle/0009_projects.sql"),
      "utf8",
    );

    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(2);
    expect(migration).toContain("CREATE TABLE `project`");
    expect(migration).toContain("CREATE TABLE `work_task_project`");
    expect(migration.match(/ON DELETE restrict ON UPDATE restrict/gu)).toHaveLength(
      2,
    );
    expect(migration).toContain("fk_work_task_project_task");
    expect(migration).toContain("fk_work_task_project_project");
    expect(migration).toContain("chk_project_status");
    expect(migration).toContain("chk_project_closure");
    expect(migration).toContain("chk_project_budget");
    expect(migration).toContain("chk_work_task_project_identity");
    expect(migration).toContain("idx_project_status_name");
    expect(migration).toContain("idx_project_type_status");
    expect(migration).toContain("idx_work_task_project_project_task");
    expect(migration).toMatch(
      /ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci/iu,
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
  });

  it("is journal entry 0009 and has both generated tables", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 9,
      tag: "0009_projects",
    });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0009_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("project");
    expect(snapshot.tables).toHaveProperty("work_task_project");
  });
});
