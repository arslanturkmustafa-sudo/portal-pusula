import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSION_CODES } from "@/platform/auth/permissions";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0019_tax_obligations.sql"),
  "utf8",
);

describe("tax obligation migration policy", () => {
  it("adds one forward-only, constrained InnoDB tax table", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain("CREATE TABLE `tax_obligation`");
    expect(migration).toContain(
      "CONSTRAINT `uq_tax_obligation_type_period` UNIQUE(`tax_type`,`period_month`)",
    );
    expect(migration).toContain("chk_tax_obligation_tax_shape");
    expect(migration).toContain("chk_tax_obligation_state");
    expect(migration).toContain(
      "ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w|REPLACE\s+INTO)\b/imu,
    );
  });

  it("keeps money, identity and allowlist fields explicit", () => {
    for (const field of [
      "system_output_vat_amount",
      "system_input_vat_amount",
      "carried_vat_credit_amount",
      "manual_adjustment_amount",
      "payable_amount",
      "closing_vat_credit_amount",
    ]) {
      expect(migration).toContain(`\`${field}\` decimal(19,4)`);
    }
    expect(migration).toContain("BINARY 'vat'");
    expect(migration).toContain("BINARY 'income_tax'");
    expect(migration).toContain("BINARY 'provisional_tax'");
    expect(migration).toContain("BINARY 'planned'");
    expect(migration).toContain("BINARY 'paid'");
    expect(migration).toContain("BINARY 'voided'");
    expect(migration).toContain("CHARACTER SET ascii COLLATE ascii_bin");
  });

  it("extends the user permission allowlist for the tax module without a gap", () => {
    const drop = migration.indexOf(
      "ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`",
    );
    const add = migration.indexOf(
      "ALTER TABLE `user_permission` ADD CONSTRAINT `chk_user_permission_code`",
    );
    expect(drop).toBeGreaterThan(migration.indexOf("CREATE INDEX"));
    expect(add).toBeGreaterThan(drop);
    expect(migration.slice(drop, add)).toMatch(
      /^ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`;--> statement-breakpoint\r?\n$/u,
    );
    for (const permission of PERMISSION_CODES) {
      expect(migration).toContain(`BINARY '${permission}'`);
    }
  });

  it("aligns journal and generated snapshot at 0019", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 19,
      tag: "0019_tax_obligations",
    });
    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0019_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { indexes?: Record<string, unknown> }> };
    expect(snapshot.tables).toHaveProperty("tax_obligation");
    expect(snapshot.tables.tax_obligation?.indexes).toHaveProperty(
      "uq_tax_obligation_type_period",
    );
  });
});
