import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0022_recurring_tasks_expenses.sql"),
  "utf8",
);

describe("recurrence migration policy", () => {
  it("adds recurrence without destructive data changes", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `recurring_expense`");
    expect(migration).toContain("ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4");
    expect(migration).toContain("uq_recurring_expense_client_operation");
    expect(migration).toContain("uq_work_task_recurrence_source");
    expect(migration).toContain("chk_recurring_expense_amounts");
    expect(migration).toContain("chk_work_task_recurrence");
    expect(migration).toContain(
      "`work_task`.`recurrence_frequency` IS NOT NULL",
    );
    expect(migration).toContain(
      "`work_task`.`recurrence_anchor_day` IS NOT NULL",
    );
    expect(migration).toContain(
      "`work_task`.`recurrence_series_id` IS NOT NULL",
    );
    expect(migration).toContain("fk_work_task_recurrence_source");
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
  });

  it("is journal entry 0022 with a complete snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0022_recurring_tasks_expenses",
      ),
    ).toMatchObject({ idx: 22, tag: "0022_recurring_tasks_expenses" });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0022_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { columns?: Record<string, unknown> }> };
    expect(snapshot.tables).toHaveProperty("recurring_expense");
    expect(snapshot.tables.work_task?.columns).toHaveProperty(
      "recurrence_frequency",
    );
  });
});
