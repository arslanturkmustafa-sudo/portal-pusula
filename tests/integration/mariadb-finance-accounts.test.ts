import { spawn } from "node:child_process";
import path from "node:path";

import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FinanceLedgerIntegrityError } from "../../src/features/finance/account-repository";
import { listFinanceAccountsOverview } from "../../src/features/finance/account-service";
import { registerMySqlPoolDatabase } from "../../src/platform/database/mysql-session-contract";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const repositoryRoot = process.cwd();
const safeEnvironmentKeys = [
  "APPDATA",
  "CI",
  "CommonProgramFiles",
  "FORCE_COLOR",
  "HOME",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "Path",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramW6432",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
] as const;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!enabled || typeof value !== "string" || value === "") {
    throw new Error("Disposable MariaDB test environment is incomplete.");
  }
  return value;
}

function migrationEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of safeEnvironmentKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const) {
    environment[key] = requiredEnvironment(key);
  }
  return environment;
}

function runMigration(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("scripts", "migrate.mjs")], {
      cwd: repositoryRoot,
      env: migrationEnvironment(),
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => reject(new Error("Migration runner did not start.")));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Migration runner failed."));
    });
  });
}

function createPool(): Pool {
  const database = requiredEnvironment("DB_NAME");
  const pool = mysql.createPool({
    charset: "utf8mb4",
    connectionLimit: 2,
    database,
    dateStrings: true,
    decimalNumbers: false,
    host: requiredEnvironment("DB_HOST"),
    multipleStatements: false,
    password: requiredEnvironment("DB_PASSWORD"),
    port: Number(requiredEnvironment("DB_PORT")),
    timezone: "Z",
    user: requiredEnvironment("DB_USER"),
  });
  registerMySqlPoolDatabase(pool, database);
  return pool;
}

const bankId = "10000000-0000-4000-8000-000000000001";
const cashId = "10000000-0000-4000-8000-000000000002";

async function insertAccount(
  pool: Pool,
  id: string,
  operationId: string,
  type: "bank" | "cash",
  name: string,
  opening: string,
): Promise<void> {
  await pool.execute(
    `INSERT INTO finance_account
       (id, client_operation_key, account_type, display_name, bank_name,
        opening_balance_amount)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, operationId, type, name, type === "bank" ? "Örnek Banka" : null, opening],
  );
}

type FixtureTransaction = Readonly<{
  amount?: string;
  id: string;
  operationId: string;
  reversalOfId?: string | null;
  reversalReason?: string | null;
  sourceAccountId?: string | null;
  targetAccountId?: string | null;
  type: "expense" | "income" | "transfer";
}>;

async function insertTransaction(
  pool: Pool,
  transaction: FixtureTransaction,
): Promise<void> {
  await pool.execute(
    `INSERT INTO finance_transaction
       (id, client_operation_key, transaction_type, occurred_on, description,
        amount, source_account_id, target_account_id, reversal_of_id,
        reversal_reason)
     VALUES (?, ?, ?, '2026-09-07', 'MariaDB doğrulama fixture', ?, ?, ?, ?, ?)`,
    [
      transaction.id,
      transaction.operationId,
      transaction.type,
      transaction.amount ?? "10.0000",
      transaction.sourceAccountId ?? null,
      transaction.targetAccountId ?? null,
      transaction.reversalOfId ?? null,
      transaction.reversalReason ?? null,
    ],
  );
}

async function insertLedgerEntry(
  pool: Pool,
  input: Readonly<{
    accountId: string;
    amount?: string;
    id: string;
    side: "inflow" | "outflow";
    transactionId: string;
  }>,
): Promise<void> {
  await pool.execute(
    `INSERT INTO finance_ledger_entry
       (id, transaction_id, account_id, entry_side, amount)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.id,
      input.transactionId,
      input.accountId,
      input.side,
      input.amount ?? "10.0000",
    ],
  );
}

describe.skipIf(!enabled).sequential("finance account reconciliation on real MariaDB", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigration();
    pool = createPool();
  }, 15_000);

  beforeEach(async () => {
    await pool.query("DELETE FROM finance_ledger_entry");
    await pool.query(
      "UPDATE finance_transaction SET reversal_of_id = NULL, reversal_reason = NULL WHERE reversal_of_id IS NOT NULL",
    );
    await pool.query("DELETE FROM finance_transaction");
    await pool.query("DELETE FROM finance_account");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("accepts a correct two-leg transfer without double-counting liquidity", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    await insertAccount(
      pool,
      cashId,
      "20000000-0000-4000-8000-000000000002",
      "cash",
      "Merkez kasa",
      "50.0000",
    );
    const transactionId = "30000000-0000-4000-8000-000000000001";
    await pool.execute(
      `INSERT INTO finance_transaction
         (id, client_operation_key, transaction_type, occurred_on, description,
          amount, source_account_id, target_account_id)
       VALUES (?, ?, 'transfer', '2026-09-07', 'Kasaya aktarım', '10.0000', ?, ?)`,
      [
        transactionId,
        "40000000-0000-4000-8000-000000000001",
        bankId,
        cashId,
      ],
    );
    await pool.execute(
      `INSERT INTO finance_ledger_entry
         (id, transaction_id, account_id, entry_side, amount)
       VALUES
         ('50000000-0000-4000-8000-000000000001', ?, ?, 'outflow', '10.0000'),
         ('50000000-0000-4000-8000-000000000002', ?, ?, 'inflow', '10.0000')`,
      [transactionId, bankId, transactionId, cashId],
    );

    const result = await listFinanceAccountsOverview(pool);
    expect(result.summary.totalLiquidBalance).toBe("150.0000");
    expect(result.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: bankId, balanceAmount: "90.0000" }),
        expect.objectContaining({ id: cashId, balanceAmount: "60.0000" }),
      ]),
    );
  });

  it("fails closed when a direct write makes a ledger amount disagree with its header", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    const transactionId = "30000000-0000-4000-8000-000000000001";
    await pool.execute(
      `INSERT INTO finance_transaction
         (id, client_operation_key, transaction_type, occurred_on, description,
          amount, target_account_id)
       VALUES (?, ?, 'income', '2026-09-07', 'Doğrudan fixture', '10.0000', ?)`,
      [transactionId, "40000000-0000-4000-8000-000000000001", bankId],
    );
    await pool.execute(
      `INSERT INTO finance_ledger_entry
         (id, transaction_id, account_id, entry_side, amount)
       VALUES ('50000000-0000-4000-8000-000000000001', ?, ?, 'inflow', '11.0000')`,
      [transactionId, bankId],
    );

    await expect(listFinanceAccountsOverview(pool)).rejects.toBeInstanceOf(
      FinanceLedgerIntegrityError,
    );
  });

  it("accepts an exact immutable reversal and leaves total liquidity unchanged", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    const originalId = "30000000-0000-4000-8000-000000000001";
    const reversalId = "30000000-0000-4000-8000-000000000002";
    await insertTransaction(pool, {
      id: originalId,
      operationId: "40000000-0000-4000-8000-000000000001",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000001",
      side: "inflow",
      transactionId: originalId,
    });
    await insertTransaction(pool, {
      id: reversalId,
      operationId: "40000000-0000-4000-8000-000000000002",
      reversalOfId: originalId,
      reversalReason: "Hatalı gelir kaydı",
      sourceAccountId: bankId,
      type: "expense",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000002",
      side: "outflow",
      transactionId: reversalId,
    });

    const result = await listFinanceAccountsOverview(pool);
    expect(result.summary.totalLiquidBalance).toBe("100.0000");
    expect(result.accounts[0]).toMatchObject({
      balanceAmount: "100.0000",
      id: bankId,
    });
  });

  it("fails closed when a reversal is cross-linked to a different account", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    await insertAccount(
      pool,
      cashId,
      "20000000-0000-4000-8000-000000000002",
      "cash",
      "Merkez kasa",
      "50.0000",
    );
    const originalId = "30000000-0000-4000-8000-000000000001";
    const reversalId = "30000000-0000-4000-8000-000000000002";
    await insertTransaction(pool, {
      id: originalId,
      operationId: "40000000-0000-4000-8000-000000000001",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000001",
      side: "inflow",
      transactionId: originalId,
    });
    await insertTransaction(pool, {
      id: reversalId,
      operationId: "40000000-0000-4000-8000-000000000002",
      reversalOfId: originalId,
      reversalReason: "Çapraz hesap fixture",
      sourceAccountId: cashId,
      type: "expense",
    });
    await insertLedgerEntry(pool, {
      accountId: cashId,
      id: "50000000-0000-4000-8000-000000000002",
      side: "outflow",
      transactionId: reversalId,
    });

    await expect(listFinanceAccountsOverview(pool)).rejects.toBeInstanceOf(
      FinanceLedgerIntegrityError,
    );
  });

  it("fails closed when a reversal amount differs from its original", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    const originalId = "30000000-0000-4000-8000-000000000001";
    const reversalId = "30000000-0000-4000-8000-000000000002";
    await insertTransaction(pool, {
      id: originalId,
      operationId: "40000000-0000-4000-8000-000000000001",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000001",
      side: "inflow",
      transactionId: originalId,
    });
    await insertTransaction(pool, {
      amount: "11.0000",
      id: reversalId,
      operationId: "40000000-0000-4000-8000-000000000002",
      reversalOfId: originalId,
      reversalReason: "Tutarı farklı fixture",
      sourceAccountId: bankId,
      type: "expense",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      amount: "11.0000",
      id: "50000000-0000-4000-8000-000000000002",
      side: "outflow",
      transactionId: reversalId,
    });

    await expect(listFinanceAccountsOverview(pool)).rejects.toBeInstanceOf(
      FinanceLedgerIntegrityError,
    );
  });

  it("fails closed when a reversal uses a non-inverse transaction kind", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    const originalId = "30000000-0000-4000-8000-000000000001";
    const reversalId = "30000000-0000-4000-8000-000000000002";
    await insertTransaction(pool, {
      id: originalId,
      operationId: "40000000-0000-4000-8000-000000000001",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000001",
      side: "inflow",
      transactionId: originalId,
    });
    await insertTransaction(pool, {
      id: reversalId,
      operationId: "40000000-0000-4000-8000-000000000002",
      reversalOfId: originalId,
      reversalReason: "Yanlış işlem türü fixture",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000002",
      side: "inflow",
      transactionId: reversalId,
    });

    await expect(listFinanceAccountsOverview(pool)).rejects.toBeInstanceOf(
      FinanceLedgerIntegrityError,
    );
  });

  it("fails closed when a reversal itself is reversed into a chain", async () => {
    await insertAccount(
      pool,
      bankId,
      "20000000-0000-4000-8000-000000000001",
      "bank",
      "İşletme hesabı",
      "100.0000",
    );
    const originalId = "30000000-0000-4000-8000-000000000001";
    const firstReversalId = "30000000-0000-4000-8000-000000000002";
    const chainedReversalId = "30000000-0000-4000-8000-000000000003";
    await insertTransaction(pool, {
      id: originalId,
      operationId: "40000000-0000-4000-8000-000000000001",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000001",
      side: "inflow",
      transactionId: originalId,
    });
    await insertTransaction(pool, {
      id: firstReversalId,
      operationId: "40000000-0000-4000-8000-000000000002",
      reversalOfId: originalId,
      reversalReason: "İlk ters kayıt",
      sourceAccountId: bankId,
      type: "expense",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000002",
      side: "outflow",
      transactionId: firstReversalId,
    });
    await insertTransaction(pool, {
      id: chainedReversalId,
      operationId: "40000000-0000-4000-8000-000000000003",
      reversalOfId: firstReversalId,
      reversalReason: "Zincir fixture",
      targetAccountId: bankId,
      type: "income",
    });
    await insertLedgerEntry(pool, {
      accountId: bankId,
      id: "50000000-0000-4000-8000-000000000003",
      side: "inflow",
      transactionId: chainedReversalId,
    });

    await expect(listFinanceAccountsOverview(pool)).rejects.toBeInstanceOf(
      FinanceLedgerIntegrityError,
    );
  });
});
