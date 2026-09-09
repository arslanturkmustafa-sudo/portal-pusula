// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readCashFlowLedger } from "@/features/finance/cash-flow-repository";

describe("cash flow repository", () => {
  it("uses the reconciled account ledger for actual cash and keeps forecast separate", async () => {
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
            amount: "600.0000",
            bucket: "scheduled",
            direction: "inflow",
            entry_count: 1,
            event_on: "2026-09-20",
            kind: "customer_receivable",
          },
          {
            amount: "35.0000",
            bucket: "undated",
            direction: "inflow",
            entry_count: "1",
            event_on: null,
            kind: "commission_receivable",
          },
          {
            amount: "80.0000",
            bucket: "scheduled",
            direction: "outflow",
            entry_count: "1",
            event_on: "2026-09-27",
            kind: "tax_payment",
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
      .mockResolvedValueOnce([[{ amount: "50.0000", entry_count: 1 }], []]);

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
      ],
      forecast: [
        {
          amount: "600.0000",
          bucket: "scheduled",
          direction: "inflow",
          entryCount: 1,
          eventOn: "2026-09-20",
          kind: "customer_receivable",
        },
        {
          amount: "35.0000",
          bucket: "undated",
          direction: "inflow",
          entryCount: 1,
          eventOn: null,
          kind: "commission_receivable",
        },
        {
          amount: "80.0000",
          bucket: "scheduled",
          direction: "outflow",
          entryCount: 1,
          eventOn: "2026-09-27",
          kind: "tax_payment",
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
    expect(execute.mock.calls[4]?.[1]).toEqual([
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    const forecastSql = String(execute.mock.calls[5]?.[0]);
    expect(forecastSql).toMatch(/total_amount - COALESCE\(rc\.collected_amount/iu);
    expect(forecastSql).toContain("r.record_state = 'active'");
    expect(forecastSql).toMatch(/cci\.status = 'planned'/iu);
    expect(forecastSql).toMatch(/pc\.status = 'agency_collected'/iu);
    expect(forecastSql).toContain("e.finance_transaction_id IS NULL");
    expect(forecastSql).toMatch(
      /r\.due_on < \? OR \(r\.due_on >= \? AND r\.due_on <= \?\)/u,
    );
    expect(forecastSql).toMatch(
      /pc\.due_on < \? OR \(pc\.due_on >= \? AND pc\.due_on <= \?\)/u,
    );
    expect(forecastSql).toMatch(
      /cci\.due_on < \? OR \(cci\.due_on >= \? AND cci\.due_on <= \?\)/u,
    );
    const taxForecastSql = forecastSql.slice(
      forecastSql.indexOf("SELECT tax_forecast.due_on"),
      forecastSql.indexOf("UNION ALL", forecastSql.indexOf("SELECT tax_forecast.due_on")),
    );
    expect(taxForecastSql).toContain("'tax_payment', 'outflow'");
    expect(taxForecastSql).toContain(
      "BINARY tax_forecast.status = BINARY 'planned'",
    );
    expect(taxForecastSql).toContain("tax_forecast.payable_amount > 0");
    expect(taxForecastSql).toMatch(
      /tax_forecast\.due_on < \?[\s\S]*tax_forecast\.due_on >= \?[\s\S]*tax_forecast\.due_on <= \?/u,
    );
    expect(forecastSql.match(/\?/gu)).toHaveLength(19);
    expect(execute.mock.calls[5]?.[1]).toEqual([
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
      "2026-09-15",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01",
      "2026-09-30",
      "2026-09-15",
    ]);

    const dueItemSql = String(execute.mock.calls[6]?.[0]);
    expect(dueItemSql).toContain("receivable.total_amount");
    expect(dueItemSql).toContain("collection.collected_amount");
    expect(dueItemSql).toContain("contribution.expected_amount");
    expect(dueItemSql).toContain("contribution.received_amount");
    expect(dueItemSql).toMatch(
      /GROUP BY card\.id, card\.display_name, card\.bank_name,[\s\S]*installment\.due_on/u,
    );
    expect(dueItemSql).toContain("SUM(installment.amount) AS total_amount");
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
    expect(dueItemSql.match(/\?/gu)).toHaveLength(26);
    expect(execute.mock.calls[6]?.[1]).toEqual([
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
  });
});
