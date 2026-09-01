import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0005_consulting_contract_visits.sql"),
  "utf8",
);

describe("consulting contract migration policy", () => {
  it("creates exactly the contract and date-based visit tables with restrictive ownership", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(2);
    expect(migration).toContain("CREATE TABLE `consulting_contract`");
    expect(migration).toContain("CREATE TABLE `monthly_visit_commitment`");
    expect(migration.match(/ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4/gu)).toHaveLength(2);
    expect(migration).toMatch(
      /`monthly_fee_amount` decimal\(19,4\) NOT NULL/iu,
    );
    expect(migration).toMatch(
      /`id` char\(36\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/iu,
    );
    expect(migration).toContain("ON DELETE restrict ON UPDATE restrict");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/iu);
  });

  it("fails closed when paired internal plan or cancellation fields are missing", () => {
    expect(migration).toMatch(
      /internal_planned_at_utc` IS NOT NULL[\s\S]*internal_duration_minutes` IS NOT NULL/iu,
    );
    expect(migration).toMatch(
      /resolution_note` IS NOT NULL[\s\S]*CHAR_LENGTH\(`monthly_visit_commitment`\.`resolution_note`\) BETWEEN 1 AND 2000/iu,
    );
  });

  it("is the final journal entry and has a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 5,
      tag: "0005_consulting_contract_visits",
    });

    const snapshot = JSON.parse(
      readFileSync(
        resolve(root, "drizzle/meta/0005_snapshot.json"),
        "utf8",
      ),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("consulting_contract");
    expect(snapshot.tables).toHaveProperty("monthly_visit_commitment");
  });
});
