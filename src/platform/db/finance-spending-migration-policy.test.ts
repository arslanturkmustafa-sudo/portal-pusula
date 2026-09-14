import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "drizzle/0010_expenses_cards.sql"),
  "utf8",
);
const partialPaymentMigration = readFileSync(
  resolve(root, "drizzle/0024_partial_card_payments.sql"),
  "utf8",
);

describe("finance spending migration policy", () => {
  it("adds only cards, expenses, and materialized card installments", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(3);
    expect(migration).toContain("CREATE TABLE `credit_card`");
    expect(migration).toContain("CREATE TABLE `expense`");
    expect(migration).toContain("CREATE TABLE `credit_card_installment`");
    expect(migration).not.toContain("CREATE TABLE `credit_card_statement`");
    expect(migration).not.toContain("CREATE TABLE `recurring_expense`");
    expect(
      migration.match(
        /ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci/gu,
      ),
    ).toHaveLength(3);
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
  });

  it("pins exact identities, money, lifecycle, and card-plan shapes", () => {
    expect(
      migration.match(/CHARACTER SET ascii COLLATE ascii_bin/gu),
    ).toHaveLength(16);
    expect(migration.match(/decimal\(19,4\)/gu)).toHaveLength(5);
    expect(migration).toContain("uq_credit_card_client_operation");
    expect(migration).toContain("uq_expense_client_operation");
    expect(migration).toContain("uq_credit_card_installment_expense_no");
    expect(migration).toContain("chk_expense_payment_shape");
    expect(migration).toContain("chk_expense_amounts");
    expect(migration).toContain("chk_expense_void_shape");
    expect(migration).toContain("chk_credit_card_installment_sequence");
    expect(migration).toContain("chk_credit_card_installment_payment");
    expect(migration).toMatch(
      /total_amount` = `expense`\.`net_amount` \+ `expense`\.`vat_amount`/u,
    );
  });

  it("uses restrictive ownership and the approved query indexes", () => {
    expect(
      migration.match(/ON DELETE restrict ON UPDATE restrict/gu),
    ).toHaveLength(3);
    expect(migration).toContain("fk_expense_project");
    expect(migration).toContain("fk_expense_credit_card");
    expect(migration).toContain("fk_credit_card_installment_expense");
    expect(migration).toContain("idx_credit_card_status_name");
    expect(migration).toContain("idx_expense_project_date");
    expect(migration).toContain("idx_expense_card_date");
    expect(migration).toContain("idx_expense_status_date");
    expect(migration).toContain("idx_credit_card_installment_due_status");
    expect(migration).toContain("idx_credit_card_installment_statement");
  });

  it("keeps its journal entry and complete generated snapshot", () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.find((entry) => entry.tag === "0010_expenses_cards"),
    ).toMatchObject({
      idx: 10,
      tag: "0010_expenses_cards",
    });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0010_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("credit_card");
    expect(snapshot.tables).toHaveProperty("expense");
    expect(snapshot.tables).toHaveProperty("credit_card_installment");
  });
});

describe("partial card payment migration policy", () => {
  it("adds an immutable payment and reversal ledger without changing installments", () => {
    expect(partialPaymentMigration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(partialPaymentMigration).toContain(
      "CREATE TABLE `credit_card_installment_payment`",
    );
    expect(partialPaymentMigration).toContain(
      "ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    );
    expect(
      partialPaymentMigration.match(
        /CHARACTER SET ascii COLLATE ascii_bin/gu,
      ),
    ).toHaveLength(6);
    expect(partialPaymentMigration).toContain("decimal(19,4) NOT NULL");
    expect(partialPaymentMigration).toContain(
      "chk_credit_card_installment_payment_entry",
    );
    expect(partialPaymentMigration).toContain(
      "uq_credit_card_installment_payment_operation",
    );
    expect(partialPaymentMigration).toContain(
      "uq_credit_card_installment_payment_reversal",
    );
    expect(partialPaymentMigration).toContain(
      "uq_credit_card_installment_payment_transaction",
    );
    expect(
      partialPaymentMigration.match(
        /ON DELETE restrict ON UPDATE restrict/gu,
      ),
    ).toHaveLength(3);
    expect(partialPaymentMigration).not.toMatch(
      /ALTER TABLE `credit_card_installment`/u,
    );
    expect(partialPaymentMigration).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|UPDATE|REPLACE)\b/imu,
    );
  });

  it("backfills every legacy paid installment with the preserved payment snapshot", () => {
    expect(partialPaymentMigration).toMatch(
      /INSERT INTO `credit_card_installment_payment`[\s\S]*?SELECT UUID\(\), UUID\(\), `id`, `finance_transaction_id`, `amount`, `paid_on`, 'payment', `updated_at_utc` FROM `credit_card_installment` WHERE BINARY `status` = BINARY 'paid'/u,
    );

    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0024_partial_card_payments",
      ),
    ).toEqual({
      breakpoints: true,
      idx: 24,
      tag: "0024_partial_card_payments",
      version: "5",
      when: 1789383073515,
    });

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/0024_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("credit_card_installment_payment");
  });
});
