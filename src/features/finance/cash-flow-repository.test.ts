// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readCashFlowLedger,
  recurringExpenseEventBelongsToReport,
} from "@/features/finance/cash-flow-repository";

describe("cash flow repository", () => {
  it("excludes scheduled recurrences before a future report range but keeps overdue carry-over", () => {
    const range = { endOn: "2026-10-31", startOn: "2026-10-01" };

    expect(
      recurringExpenseEventBelongsToReport("2026-09-20", range, "2026-09-15"),
    ).toBe(false);
    expect(
      recurringExpenseEventBelongsToReport("2026-09-10", range, "2026-09-15"),
    ).toBe(true);
    expect(
      recurringExpenseEventBelongsToReport("2026-10-05", range, "2026-09-15"),
    ).toBe(true);
  });

  it("uses one due-item query for both the vade plan and remaining forecast", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [
          {
            account_count: 2,
            closing_balance_amount: "1325.2500",
            current_asset_amount: "1500.0000",
            opening_balance_amount: "1000.0000",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            account_count: "1",
            amount: "250.0000",
            event_on: "2026-09-12",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            entry_count: "2",
            event_on: "2026-09-07",
            inflow_amount: "400.2500",
            outflow_amount: "75.0000",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            direction: "inflow",
            due_on: "2026-09-20",
            id: "receivable:30000000-0000-4000-8000-000000000001",
            kind: "customer_receivable",
            label: "Eylül danışmanlık hizmeti",
            remaining_amount: "400.0000",
            settled_amount: "200.0000",
            source_label: "Acme · Danışmanlık",
            status: "partial",
            total_amount: "600.0000",
          },
          {
            direction: "outflow",
            due_on: "2026-09-25",
            id: "card_payment:30000000-0000-4000-8000-000000000002:2026-09-25",
            kind: "card_payment",
            label: "Şirket kartı kart borcu",
            remaining_amount: "600.0000",
            settled_amount: "300.0000",
            source_label: "Örnek Banka",
            status: "partial",
            total_amount: "900.0000",
          },
          {
            direction: "outflow",
            due_on: "2026-09-22",
            id: "other_expense:rent:2026-09-22",
            kind: "other_expense",
            label: "Kira · 1 kayıt",
            remaining_amount: "250.0000",
            settled_amount: "0.0000",
            source_label: null,
            status: "scheduled",
            total_amount: "250.0000",
          },
          {
            direction: "inflow",
            due_on: "2026-08-31",
            id: "partner_contribution:30000000-0000-4000-8000-000000000003",
            kind: "partner_contribution",
            label: "Ortak katkısı",
            remaining_amount: "800.0000",
            settled_amount: "200.0000",
            source_label: "Gayrimenkul projesi",
            status: "overdue",
            total_amount: "1000.0000",
          },
          {
            direction: "outflow",
            due_on: "2026-09-10",
            id: "tax_payment:30000000-0000-4000-8000-000000000004",
            kind: "tax_payment",
            label: "KDV",
            remaining_amount: "0.0000",
            settled_amount: "120.0000",
            source_label: "2026-08",
            status: "settled",
            total_amount: "120.0000",
          },
          {
            direction: "outflow",
            due_on: "2026-09-27",
            id: "tax_payment:30000000-0000-4000-8000-000000000005",
            kind: "tax_payment",
            label: "Gelir vergisi",
            remaining_amount: "80.0000",
            settled_amount: "0.0000",
            source_label: "2026-08",
            status: "planned",
            total_amount: "80.0000",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            amount: "50.0000",
            entry_count: 1,
            undated_inflow_amount: "35.0000",
            undated_inflow_count: 1,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            anchor_day: "31",
            category_label: "Kira",
            credit_card_label: null,
            description: "Ofis kirası",
            ends_on: "2026-09-30",
            frequency: "monthly",
            id: "30000000-0000-4000-8000-000000000006",
            next_due_on: "2026-08-31",
            payment_due_day: null,
            payment_method: "bank_transfer",
            project_label: "Genel operasyon",
            source_account_label: "Ticari hesap",
            statement_closing_day: null,
            total_amount: "16500.0000",
          },
          {
            anchor_day: "20",
            category_label: "Yazılım",
            credit_card_label: "Şirket kartı",
            description: "Yazılım aboneliği",
            ends_on: "2026-08-20",
            frequency: "monthly",
            id: "30000000-0000-4000-8000-000000000007",
            next_due_on: "2026-08-20",
            payment_due_day: "5",
            payment_method: "credit_card",
            project_label: null,
            source_account_label: null,
            statement_closing_day: "25",
            total_amount: "1200.0000",
          },
        ],
        [],
      ]);

    await expect(
      readCashFlowLedger(
        { execute } as unknown as PoolConnection,
        { endOn: "2026-09-30", startOn: "2026-09-01" },
        "2026-09-15",
      ),
    ).resolves.toEqual({
      accountOpenings: [
        {
          accountCount: 1,
          amount: "250.0000",
          eventOn: "2026-09-12",
        },
      ],
      actual: [
        {
          entryCount: 2,
          eventOn: "2026-09-07",
          inflowAmount: "400.2500",
          outflowAmount: "75.0000",
        },
      ],
      balance: {
        accountCount: 2,
        closingBalanceAmount: "1325.2500",
        currentAssetAmount: "1500.0000",
        openingBalanceAmount: "1000.0000",
      },
      dueItems: [
        {
          direction: "inflow",
          dueOn: "2026-09-20",
          id: "receivable:30000000-0000-4000-8000-000000000001",
          kind: "customer_receivable",
          label: "Eylül danışmanlık hizmeti",
          remainingAmount: "400.0000",
          settledAmount: "200.0000",
          sourceLabel: "Acme · Danışmanlık",
          status: "partial",
          totalAmount: "600.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-09-25",
          id: "card_payment:30000000-0000-4000-8000-000000000002:2026-09-25",
          kind: "card_payment",
          label: "Şirket kartı kart borcu",
          remainingAmount: "600.0000",
          settledAmount: "300.0000",
          sourceLabel: "Örnek Banka",
          status: "partial",
          totalAmount: "900.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-09-22",
          id: "other_expense:rent:2026-09-22",
          kind: "other_expense",
          label: "Kira · 1 kayıt",
          remainingAmount: "250.0000",
          settledAmount: "0.0000",
          sourceLabel: null,
          status: "scheduled",
          totalAmount: "250.0000",
        },
        {
          direction: "inflow",
          dueOn: "2026-08-31",
          id: "partner_contribution:30000000-0000-4000-8000-000000000003",
          kind: "partner_contribution",
          label: "Ortak katkısı",
          remainingAmount: "800.0000",
          settledAmount: "200.0000",
          sourceLabel: "Gayrimenkul projesi",
          status: "overdue",
          totalAmount: "1000.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-09-10",
          id: "tax_payment:30000000-0000-4000-8000-000000000004",
          kind: "tax_payment",
          label: "KDV",
          remainingAmount: "0.0000",
          settledAmount: "120.0000",
          sourceLabel: "2026-08",
          status: "settled",
          totalAmount: "120.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-09-27",
          id: "tax_payment:30000000-0000-4000-8000-000000000005",
          kind: "tax_payment",
          label: "Gelir vergisi",
          remainingAmount: "80.0000",
          settledAmount: "0.0000",
          sourceLabel: "2026-08",
          status: "planned",
          totalAmount: "80.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-08-31",
          id: "recurring_expense:30000000-0000-4000-8000-000000000006:2026-08-31",
          kind: "other_expense",
          label: "Ofis kirası",
          remainingAmount: "16500.0000",
          settledAmount: "0.0000",
          sourceLabel: "Kira · Genel operasyon · Ticari hesap",
          status: "overdue",
          totalAmount: "16500.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-09-30",
          id: "recurring_expense:30000000-0000-4000-8000-000000000006:2026-09-30",
          kind: "other_expense",
          label: "Ofis kirası",
          remainingAmount: "16500.0000",
          settledAmount: "0.0000",
          sourceLabel: "Kira · Genel operasyon · Ticari hesap",
          status: "planned",
          totalAmount: "16500.0000",
        },
        {
          direction: "outflow",
          dueOn: "2026-09-05",
          id: "recurring_expense:30000000-0000-4000-8000-000000000007:2026-08-20",
          kind: "card_payment",
          label: "Yazılım aboneliği",
          remainingAmount: "1200.0000",
          settledAmount: "0.0000",
          sourceLabel: "Yazılım · Şirket kartı",
          status: "overdue",
          totalAmount: "1200.0000",
        },
      ],
      forecast: [
        {
          amount: "800.0000",
          bucket: "overdue",
          direction: "inflow",
          entryCount: 1,
          eventOn: "2026-08-31",
          kind: "partner_contribution",
        },
        {
          amount: "16500.0000",
          bucket: "overdue",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-08-31",
          kind: "direct_expense",
        },
        {
          amount: "1200.0000",
          bucket: "overdue",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-09-05",
          kind: "card_installment",
        },
        {
          amount: "400.0000",
          bucket: "scheduled",
          direction: "inflow",
          entryCount: 1,
          eventOn: "2026-09-20",
          kind: "customer_receivable",
        },
        {
          amount: "250.0000",
          bucket: "scheduled",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-09-22",
          kind: "direct_expense",
        },
        {
          amount: "600.0000",
          bucket: "scheduled",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-09-25",
          kind: "card_installment",
        },
        {
          amount: "80.0000",
          bucket: "scheduled",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-09-27",
          kind: "tax_payment",
        },
        {
          amount: "16500.0000",
          bucket: "scheduled",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-09-30",
          kind: "direct_expense",
        },
        {
          amount: "35.0000",
          bucket: "undated",
          direction: "inflow",
          entryCount: 1,
          eventOn: null,
          kind: "commission_receivable",
        },
      ],
      unclassifiedExpenseAmount: "50.0000",
      unclassifiedExpenseCount: 1,
    });

    expect(execute).toHaveBeenCalledTimes(8);
    expect(String(execute.mock.calls[0]?.[0])).toContain("finance_transaction");

    const balanceSql = String(execute.mock.calls[2]?.[0]);
    expect(balanceSql).toMatch(/SUM\(a\.opening_balance_amount\)/u);
    expect(balanceSql).toMatch(
      /DATE\(CONVERT_TZ\(a\.created_at_utc, '\+00:00', '\+03:00'\)\) < \?/u,
    );
    expect(balanceSql).toMatch(
      /DATE\(CONVERT_TZ\(a\.created_at_utc, '\+00:00', '\+03:00'\)\) <= \?/u,
    );
    expect(balanceSql).toMatch(/t\.occurred_on < \?/u);
    expect(balanceSql).toMatch(/t\.occurred_on <= \?/u);
    expect(execute.mock.calls[2]?.[1]).toEqual([
      "2026-09-30",
      "2026-09-15",
      "2026-09-01",
      "2026-09-15",
      "2026-09-01",
      "2026-09-15",
      "2026-09-30",
      "2026-09-15",
      "2026-09-30",
      "2026-09-15",
      "2026-09-15",
      "2026-09-15",
    ]);
    expect(balanceSql).toContain("AS current_asset_amount");
    expect(balanceSql.match(/\?/gu)).toHaveLength(12);
    expect(balanceSql.match(/t\.reversal_of_id IS NULL/gu)).toHaveLength(3);
    expect(
      balanceSql.match(/FROM finance_transaction reversal/gu),
    ).toHaveLength(3);
    expect(
      balanceSql.match(/reversal\.reversal_of_id = t\.id/gu),
    ).toHaveLength(3);

    const accountOpeningSql = String(execute.mock.calls[3]?.[0]);
    expect(accountOpeningSql).toMatch(
      /CONVERT_TZ\(a\.created_at_utc, '\+00:00', '\+03:00'\)/u,
    );
    expect(execute.mock.calls[3]?.[1]).toEqual([
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    const actualSql = String(execute.mock.calls[4]?.[0]);
    expect(actualSql).toMatch(/FROM finance_transaction t/u);
    expect(actualSql).toMatch(/JOIN finance_ledger_entry le/u);
    expect(actualSql).toMatch(/transaction_type = BINARY 'income'/u);
    expect(actualSql).toMatch(/transaction_type = BINARY 'expense'/u);
    expect(actualSql).not.toMatch(/transaction_type = BINARY 'transfer'[\s\S]*THEN le\.amount/u);
    expect(actualSql).toContain("t.reversal_of_id IS NULL");
    expect(actualSql).toContain("FROM finance_transaction reversal");
    expect(actualSql).toContain("reversal.reversal_of_id = t.id");
    expect(execute.mock.calls[4]?.[1]).toEqual([
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    expect(execute.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
      "SELECT forecast.event_on",
    );

    const dueItemSql = String(execute.mock.calls[5]?.[0]);
    expect(dueItemSql).toContain("receivable.total_amount");
    expect(dueItemSql).toContain("collection.collected_amount");
    expect(dueItemSql).toContain("contribution.expected_amount");
    expect(dueItemSql).toContain("contribution.received_amount");
    expect(dueItemSql).toMatch(
      /GROUP BY card\.id, card\.display_name, card\.bank_name,[\s\S]*installment\.due_on/u,
    );
    expect(dueItemSql).toContain("SUM(installment.amount) AS total_amount");
    expect(dueItemSql).toContain(
      "FROM credit_card_installment_payment entry",
    );
    expect(dueItemSql).toContain(
      "WHEN BINARY entry.entry_type = BINARY 'reversal'",
    );
    expect(dueItemSql).toContain("THEN -entry.amount");
    expect(dueItemSql).toContain("WHEN card_entry.entry_count > 0");
    expect(dueItemSql).toMatch(
      /WHEN installment\.status = 'paid'[\s\S]*THEN installment\.amount/u,
    );
    expect(dueItemSql).toContain("'card_payment'");
    expect(dueItemSql).toMatch(
      /GROUP BY expense\.category, category\.display_name, expense\.incurred_on/u,
    );
    expect(dueItemSql).toContain("'other_expense'");
    expect(dueItemSql).toContain(
      "payment_method IN ('cash', 'bank_transfer', 'other')",
    );
    expect(dueItemSql).toContain("expense.finance_transaction_id IS NULL");
    expect(dueItemSql).toContain("expense.incurred_on > ?");
    expect(dueItemSql).not.toContain("expense.description");
    expect(dueItemSql).not.toContain("expense.vendor_name");
    expect(dueItemSql).not.toContain("FROM finance_transaction");
    expect(dueItemSql).not.toContain("partnership_commission");
    const taxDueSql = dueItemSql.slice(
      dueItemSql.indexOf("SELECT CONCAT('tax_payment:'"),
      dueItemSql.indexOf("UNION ALL", dueItemSql.indexOf("SELECT CONCAT('tax_payment:'")),
    );
    expect(taxDueSql).toMatch(
      /CASE BINARY tax_due\.tax_type[\s\S]*'KDV'[\s\S]*'Gelir vergisi'[\s\S]*'Geçici vergi'/u,
    );
    expect(taxDueSql).toContain("DATE_FORMAT(tax_due.period_month, '%Y-%m')");
    expect(taxDueSql).toContain(
      "WHEN BINARY tax_due.status = BINARY 'paid' THEN 'settled'",
    );
    expect(taxDueSql).toContain(
      "BINARY tax_due.status <> BINARY 'voided'",
    );
    expect(taxDueSql).toContain("tax_due.payable_amount > 0");
    expect(taxDueSql).not.toContain("paid_on");
    expect(dueItemSql.match(/\?/gu)).toHaveLength(27);
    expect(execute.mock.calls[5]?.[1]).toEqual([
      // Customer receivable.
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01",
      "2026-09-15",
      // Partner contribution.
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01",
      "2026-09-15",
      // Card payment.
      "2026-09-15",
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01",
      "2026-09-15",
      "2026-09-01",
      // Tax obligation.
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01",
      "2026-09-15",
      // Other expense.
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    const unclassifiedSql = String(execute.mock.calls[6]?.[0]);
    expect(unclassifiedSql).toContain("FROM partnership_commission commission");
    expect(unclassifiedSql).toContain(
      "BINARY commission.status = BINARY 'agency_collected'",
    );

    const recurringExpenseSql = String(execute.mock.calls[7]?.[0]);
    expect(recurringExpenseSql).toContain("FROM recurring_expense recurring");
    expect(recurringExpenseSql).toContain(
      "BINARY recurring.status = BINARY 'active'",
    );
    expect(recurringExpenseSql).toContain(
      "LEFT JOIN expense_category category",
    );
    expect(recurringExpenseSql).toContain(
      "LEFT JOIN finance_account source_account",
    );
    expect(recurringExpenseSql).toContain("LEFT JOIN credit_card card");
    expect(recurringExpenseSql).toContain("LEFT JOIN project project");
    expect(recurringExpenseSql).toContain("recurring.payment_method");
    expect(recurringExpenseSql).toContain("card.statement_closing_day");
    expect(recurringExpenseSql).toContain("card.payment_due_day");
    expect(execute.mock.calls[7]?.[1]).toEqual(["2026-09-30"]);
  });
});
