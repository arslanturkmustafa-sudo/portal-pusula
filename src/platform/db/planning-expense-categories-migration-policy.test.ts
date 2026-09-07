import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { monthlyVisitCommitment } from "./schema/consulting-contract";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0018_planning_expense_categories.sql"),
  "utf8",
);

describe("planning and expense categories migration policy", () => {
  it("adds one nullable visit location and one constrained category catalog", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `expense_category`");
    expect(migration).toContain(
      "ALTER TABLE `monthly_visit_commitment` ADD `location_label` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
    expect(migration).toContain("chk_expense_category_code");
    expect(migration).toContain(
      "`code` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    );
    expect(migration).toContain("chk_expense_category_flags");
    expect(migration).toContain(
      "CONSTRAINT `uq_expense_category_display_name` UNIQUE(`display_name`)",
    );
    expect(migration).toContain("chk_monthly_visit_optional_fields");
    expect(migration).toContain(
      "ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w|REPLACE\s+INTO)\b/imu,
    );
  });

  it("seeds every legacy category before enforcing restrictive ownership", () => {
    for (const code of [
      "rent",
      "software_subscription",
      "transportation",
      "meals_hospitality",
      "marketing",
      "office",
      "external_service",
      "tax_fee",
      "other",
    ]) {
      expect(migration).toContain(`'${code}'`);
    }
    const seed = migration.indexOf("INSERT INTO `expense_category`");
    const foreignKey = migration.indexOf(
      "ADD CONSTRAINT `fk_expense_category` FOREIGN KEY",
    );
    expect(seed).toBeGreaterThan(-1);
    expect(foreignKey).toBeGreaterThan(seed);
    expect(migration).toContain("ON DELETE restrict ON UPDATE restrict");
  });

  it("keeps journal and generated snapshot aligned at 0018", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0018_planning_expense_categories",
      ),
    ).toMatchObject({ idx: 18, tag: "0018_planning_expense_categories" });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0018_snapshot.json"), "utf8"),
    ) as {
      tables: Record<
        string,
        {
          columns?: Record<string, unknown>;
          indexes?: Record<string, unknown>;
        }
      >;
    };
    expect(snapshot.tables).toHaveProperty("expense_category");
    expect(snapshot.tables.expense_category?.indexes).toHaveProperty(
      "uq_expense_category_display_name",
    );
    expect(
      snapshot.tables.monthly_visit_commitment?.columns?.location_label,
    ).toMatchObject({
      notNull: false,
      type: "varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    });
    expect(monthlyVisitCommitment.locationLabel.getSQLType()).toBe(
      "varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
  });
});
