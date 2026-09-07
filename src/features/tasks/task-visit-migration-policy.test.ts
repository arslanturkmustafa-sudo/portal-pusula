import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("work task visit migration policy", () => {
  it("adds one forward-only restrictive task-to-visit link table", () => {
    const migration = readFileSync(
      resolve(root, "drizzle/0017_work_task_visit.sql"),
      "utf8",
    );

    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `work_task_visit`");
    expect(
      migration.match(
        /`(?:task|visit)_id` char\(36\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/giu,
      ),
    ).toHaveLength(2);
    expect(migration).toMatch(
      /ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci/iu,
    );
    expect(migration).toContain(
      "CONSTRAINT `pk_work_task_visit` PRIMARY KEY(`task_id`)",
    );
    expect(migration).toContain("fk_work_task_visit_task");
    expect(migration).toContain("fk_work_task_visit_visit");
    expect(migration.match(/ON DELETE restrict ON UPDATE restrict/gu)).toHaveLength(
      2,
    );
    expect(migration).toContain("idx_work_task_visit_visit_task");
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
  });

  it("is journal entry 0017 and has a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find((entry) => entry.tag === "0017_work_task_visit"),
    ).toMatchObject({ idx: 17, tag: "0017_work_task_visit" });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0017_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("work_task_visit");
  });
});
