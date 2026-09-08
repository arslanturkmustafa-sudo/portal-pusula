import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSION_CODES } from "@/platform/auth/permissions";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0016_finance_accounts_ledger.sql"),
  "utf8",
);

describe("finance accounts ledger migration policy", () => {
  it("creates exactly three durable TRY ledger tables", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(3);
    expect(migration).toContain("CREATE TABLE `finance_account`");
    expect(migration).toContain("CREATE TABLE `finance_transaction`");
    expect(migration).toContain("CREATE TABLE `finance_ledger_entry`");
    expect(
      migration.match(/ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4/gu),
    ).toHaveLength(3);
    expect(migration.match(/decimal\(19,4\)/gu)).toHaveLength(3);
    expect(migration).toContain("chk_finance_account_currency");
    expect(migration).toContain("chk_finance_transaction_amount");
    expect(migration).toContain("chk_finance_ledger_entry_amount");
  });

  it("pins an atomic two-leg transfer and append-only reversal shape", () => {
    expect(migration).toContain("uq_finance_ledger_transaction_side");
    expect(migration).toContain("uq_finance_ledger_transaction_account");
    expect(migration).toContain("chk_finance_transaction_shape");
    expect(migration).toContain("uq_finance_transaction_reversal");
    expect(migration).toContain("fk_finance_transaction_reversal");
    expect(migration).toContain("reversal_reason");
    expect(migration).toContain("ON DELETE restrict ON UPDATE restrict");
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE FROM|TRUNCATE)\s+/imu);
  });

  it("replaces the permission constraint only after finance DDL and without a gap", () => {
    const drop = migration.indexOf(
      "ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`",
    );
    const add = migration.indexOf(
      "ALTER TABLE `user_permission` ADD CONSTRAINT `chk_user_permission_code`",
    );
    const finalFinanceIndex = migration.indexOf(
      "CREATE INDEX `idx_finance_transaction_target_occurred`",
    );
    expect(finalFinanceIndex).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(finalFinanceIndex);
    expect(add).toBeGreaterThan(drop);
    expect(migration.slice(drop, add)).toMatch(
      /^ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`;--> statement-breakpoint\r?\n$/u,
    );
    for (const permission of PERMISSION_CODES.filter(
      (code) => !code.startsWith("finance.taxes."),
    )) {
      expect(migration).toContain(`BINARY '${permission}'`);
    }
  });

  it("is journal entry 0016 and has the matching generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find((entry) => entry.tag === "0016_finance_accounts_ledger"),
    ).toMatchObject({ idx: 16, tag: "0016_finance_accounts_ledger" });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0016_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("finance_account");
    expect(snapshot.tables).toHaveProperty("finance_transaction");
    expect(snapshot.tables).toHaveProperty("finance_ledger_entry");
  });
});
