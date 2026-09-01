import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0006_receivables.sql"),
  "utf8",
);

describe("receivables migration policy", () => {
  it("creates exactly the receivable and append-only collection tables", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(2);
    expect(migration).toContain("CREATE TABLE `receivable`");
    expect(migration).toContain("CREATE TABLE `receivable_collection`");
    expect(
      migration.match(/ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4/gu),
    ).toHaveLength(2);
    expect(migration.match(/decimal\(19,4\)/gu)).toHaveLength(4);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/iu);
  });

  it("pins idempotent contract months, immutable snapshots and restrictive ownership", () => {
    expect(migration).toContain("uq_receivable_contract_month");
    expect(migration).toContain("uq_receivable_opening_operation");
    expect(migration).toContain("uq_receivable_collection_operation");
    expect(migration.match(/`client_operation_key` char\(36\)/gu)).toHaveLength(2);
    expect(migration).toMatch(
      /total_amount` = `receivable`\.`net_amount` \+ `receivable`\.`vat_amount`/iu,
    );
    expect(migration.match(/ON DELETE restrict ON UPDATE restrict/gu)).toHaveLength(
      3,
    );
    expect(migration).toContain("chk_receivable_collection_amount");
  });

  it("is journal entry 0006 and has a generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 6,
      tag: "0006_receivables",
    });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0006_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("receivable");
    expect(snapshot.tables).toHaveProperty("receivable_collection");
  });
});
