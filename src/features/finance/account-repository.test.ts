// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertFinanceLedgerReconciled,
  FinanceLedgerIntegrityError,
  findCardInstallmentByFinanceTransactionForUpdate,
  findFinanceAccountBalanceRecord,
  insertFinanceLedgerEntries,
  listFinanceAccountBalanceRecords,
  lockFinanceAccounts,
} from "@/features/finance/account-repository";

const accountRow = {
  account_type: "bank",
  balance_amount: "145.5000",
  bank_name: "Örnek Banka",
  client_operation_key: "10000000-0000-4000-8000-000000000001",
  created_at_utc: "2026-09-07 09:00:00.000000",
  currency: "TRY",
  display_name: "İşletme hesabı",
  id: "20000000-0000-4000-8000-000000000001",
  opening_balance_amount: "100.0000",
  status: "active",
  updated_at_utc: "2026-09-07 09:00:00.000000",
  version: 1,
};

describe("finance account repository", () => {
  it("treats a partial card payment ledger movement as installment-managed", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [{ id: "30000000-0000-4000-8000-000000000001" }],
        [],
      ]);

    await expect(
      findCardInstallmentByFinanceTransactionForUpdate(
        { execute } as unknown as PoolConnection,
        "40000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe("30000000-0000-4000-8000-000000000001");

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toContain(
      "FROM credit_card_installment",
    );
    expect(execute.mock.calls[1]?.[0]).toContain(
      "FROM credit_card_installment_payment",
    );
    expect(execute.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    expect(execute.mock.calls[1]?.[1]).toEqual([
      "40000000-0000-4000-8000-000000000001",
    ]);
  });

  it("derives account balance only from opening balance and signed ledger entries", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[accountRow], []]);
    const result = await listFinanceAccountBalanceRecords({ execute } as unknown as PoolConnection);
    expect(result[0]).toMatchObject({ balanceAmount: "145.5000", currency: "TRY" });
    const sql = execute.mock.calls[2]?.[0] as string;
    expect(sql).toContain("opening_balance_amount + COALESCE(SUM");
    expect(sql).toContain("LEFT JOIN finance_ledger_entry");
    expect(sql).toContain("THEN -le.amount");
    expect(sql).toContain("AS DECIMAL(65,4)");
    expect(sql).not.toContain("JOIN finance_transaction");
  });

  it("fails closed before returning a balance when a header and ledger disagree", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      [{ transaction_id: "30000000-0000-4000-8000-000000000001" }],
      [],
    ]);
    await expect(
      listFinanceAccountBalanceRecords({ execute } as unknown as PoolConnection),
    ).rejects.toBeInstanceOf(FinanceLedgerIntegrityError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reconciles all transfer legs and scopes a single-account read", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[accountRow], []]);
    await expect(
      findFinanceAccountBalanceRecord(
        { execute } as unknown as PoolConnection,
        accountRow.id,
      ),
    ).resolves.toMatchObject({ id: accountRow.id, balanceAmount: "145.5000" });
    const reconciliationSql = execute.mock.calls[0]?.[0] as string;
    expect(reconciliationSql).toContain("COUNT(le.id)");
    expect(reconciliationSql).toContain("t.transaction_type");
    expect(reconciliationSql).toContain("le.amount <> t.amount");
    expect(reconciliationSql).toContain("le.currency <> BINARY t.currency");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      accountRow.id,
      accountRow.id,
      accountRow.id,
    ]);
    expect(execute.mock.calls[1]?.[1]).toEqual([
      accountRow.id,
      accountRow.id,
      accountRow.id,
      accountRow.id,
    ]);
  });

  it("accepts a reconciled full ledger without exposing a mismatch row", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);
    await expect(
      assertFinanceLedgerReconciled({ execute } as unknown as PoolConnection),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a reversal does not exactly invert its original", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [{ transaction_id: "30000000-0000-4000-8000-000000000002" }],
        [],
      ]);
    await expect(
      assertFinanceLedgerReconciled({ execute } as unknown as PoolConnection),
    ).rejects.toBeInstanceOf(FinanceLedgerIntegrityError);
    const reversalSql = execute.mock.calls[1]?.[0] as string;
    expect(reversalSql).toContain("original.reversal_of_id IS NOT NULL");
    expect(reversalSql).toContain("reversal.amount <> original.amount");
    expect(reversalSql).toContain("reversal.currency <> BINARY original.currency");
    expect(reversalSql).toContain("reversal.transaction_type = BINARY 'expense'");
    expect(reversalSql).toContain(
      "reversal.source_account_id = BINARY original.target_account_id",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("locks account ids in stable order before an atomic transfer", async () => {
    const execute = vi.fn().mockResolvedValue([[accountRow], []]);
    await lockFinanceAccounts(
      { execute } as unknown as PoolConnection,
      [
        "30000000-0000-4000-8000-000000000002",
        "30000000-0000-4000-8000-000000000001",
        "30000000-0000-4000-8000-000000000002",
      ],
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ]);
    expect(execute.mock.calls[0]?.[0]).toContain("FOR UPDATE");
  });

  it("appends each transfer leg and never issues an update or delete", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    await insertFinanceLedgerEntries(
      { execute } as unknown as PoolConnection,
      [
        {
          accountId: "10000000-0000-4000-8000-000000000001",
          amount: "10.0000",
          createdAtUtc: "2026-09-07 09:00:00.000000",
          currency: "TRY",
          entrySide: "outflow",
          id: "20000000-0000-4000-8000-000000000001",
          transactionId: "30000000-0000-4000-8000-000000000001",
        },
        {
          accountId: "10000000-0000-4000-8000-000000000002",
          amount: "10.0000",
          createdAtUtc: "2026-09-07 09:00:00.000000",
          currency: "TRY",
          entrySide: "inflow",
          id: "20000000-0000-4000-8000-000000000002",
          transactionId: "30000000-0000-4000-8000-000000000001",
        },
      ],
    );
    expect(execute).toHaveBeenCalledTimes(2);
    for (const [sql] of execute.mock.calls) {
      expect(sql).toMatch(/^INSERT INTO finance_ledger_entry/u);
      expect(sql).not.toMatch(/\b(?:UPDATE|DELETE)\b/u);
    }
  });
});
