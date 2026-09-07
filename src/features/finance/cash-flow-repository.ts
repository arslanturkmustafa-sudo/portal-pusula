import "server-only";

import Decimal from "decimal.js";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { assertFinanceLedgerReconciled } from "@/features/finance/account-repository";

export type CashFlowDirection = "inflow" | "outflow";
export type CashFlowForecastKind =
  | "card_installment"
  | "commission_receivable"
  | "customer_receivable"
  | "direct_expense"
  | "partner_contribution";
export type CashFlowForecastBucket = "overdue" | "scheduled" | "undated";

export type CashFlowActualDailyAggregate = Readonly<{
  entryCount: number;
  eventOn: string;
  inflowAmount: string;
  outflowAmount: string;
}>;

export type CashFlowAccountOpeningDailyAggregate = Readonly<{
  accountCount: number;
  amount: string;
  eventOn: string;
}>;

export type CashFlowForecastAggregate = Readonly<{
  amount: string;
  bucket: CashFlowForecastBucket;
  direction: CashFlowDirection;
  entryCount: number;
  eventOn: string | null;
  kind: CashFlowForecastKind;
}>;

export type CashFlowBalanceSnapshot = Readonly<{
  accountCount: number;
  closingBalanceAmount: string;
  openingBalanceAmount: string;
}>;

export type CashFlowLedgerSnapshot = Readonly<{
  accountOpenings: readonly CashFlowAccountOpeningDailyAggregate[];
  actual: readonly CashFlowActualDailyAggregate[];
  balance: CashFlowBalanceSnapshot;
  forecast: readonly CashFlowForecastAggregate[];
  unclassifiedExpenseAmount: string;
  unclassifiedExpenseCount: number;
}>;

type BalanceRow = RowDataPacket & {
  account_count: number | string;
  closing_balance_amount: string;
  opening_balance_amount: string;
};

type ActualRow = RowDataPacket & {
  entry_count: number | string;
  event_on: string | Date;
  inflow_amount: string;
  outflow_amount: string;
};

type AccountOpeningRow = RowDataPacket & {
  account_count: number | string;
  amount: string;
  event_on: string | Date;
};

type ForecastRow = RowDataPacket & {
  amount: string;
  bucket: string;
  direction: string;
  entry_count: number | string;
  event_on: string | Date | null;
  kind: string;
};

type UnclassifiedRow = RowDataPacket & {
  amount: string;
  entry_count: number | string;
};

function money(value: string): string {
  return new Decimal(value).toFixed(4);
}

function count(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Cash flow count is invalid.");
  }
  return parsed;
}

function canonicalDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function direction(value: string): CashFlowDirection {
  if (value !== "inflow" && value !== "outflow") {
    throw new Error("Cash flow direction is invalid.");
  }
  return value;
}

function forecastKind(value: string): CashFlowForecastKind {
  if (
    value !== "card_installment" &&
    value !== "commission_receivable" &&
    value !== "customer_receivable" &&
    value !== "direct_expense" &&
    value !== "partner_contribution"
  ) {
    throw new Error("Cash flow forecast kind is invalid.");
  }
  return value;
}

function bucket(value: string): CashFlowForecastBucket {
  if (value !== "overdue" && value !== "scheduled" && value !== "undated") {
    throw new Error("Cash flow forecast bucket is invalid.");
  }
  return value;
}

export async function readCashFlowLedger(
  connection: PoolConnection,
  range: Readonly<{ endOn: string; startOn: string }>,
  generatedOn: string,
): Promise<CashFlowLedgerSnapshot> {
  await assertFinanceLedgerReconciled(connection);

  const [balanceRows] = await connection.execute<BalanceRow[]>(
    `SELECT
       (SELECT COUNT(*)
          FROM finance_account a
         WHERE DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
           AND DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
       ) AS account_count,
       CAST(
         COALESCE((
           SELECT SUM(a.opening_balance_amount)
             FROM finance_account a
            WHERE DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) < ?
              AND DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
         ), 0.0000)
         + COALESCE((
             SELECT SUM(
               CASE
                 WHEN BINARY le.entry_side = BINARY 'inflow' THEN le.amount
                 WHEN BINARY le.entry_side = BINARY 'outflow' THEN -le.amount
                 ELSE 0.0000
               END
             )
               FROM finance_ledger_entry le
               JOIN finance_transaction t ON t.id = le.transaction_id
              WHERE t.occurred_on < ? AND t.occurred_on <= ?
           ), 0.0000)
         AS DECIMAL(65,4)
       ) AS opening_balance_amount,
       CAST(
         COALESCE((
           SELECT SUM(a.opening_balance_amount)
             FROM finance_account a
            WHERE DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
              AND DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
         ), 0.0000)
         + COALESCE((
             SELECT SUM(
               CASE
                 WHEN BINARY le.entry_side = BINARY 'inflow' THEN le.amount
                 WHEN BINARY le.entry_side = BINARY 'outflow' THEN -le.amount
                 ELSE 0.0000
               END
             )
               FROM finance_ledger_entry le
               JOIN finance_transaction t ON t.id = le.transaction_id
              WHERE t.occurred_on <= ? AND t.occurred_on <= ?
           ), 0.0000)
         AS DECIMAL(65,4)
       ) AS closing_balance_amount`,
    [
      range.endOn,
      generatedOn,
      range.startOn,
      generatedOn,
      range.startOn,
      generatedOn,
      range.endOn,
      generatedOn,
      range.endOn,
      generatedOn,
    ],
  );
  const balance = balanceRows[0];
  if (!balance) throw new Error("Cash flow balance aggregate is missing.");

  const [accountOpeningRows] = await connection.execute<AccountOpeningRow[]>(
    `SELECT DATE_FORMAT(
              CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00'),
              '%Y-%m-%d'
            ) AS event_on,
            COUNT(*) AS account_count,
            CAST(COALESCE(SUM(a.opening_balance_amount), 0.0000)
              AS DECIMAL(65,4)) AS amount
       FROM finance_account a
      WHERE DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) >= ?
        AND DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
        AND DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
      GROUP BY event_on
      ORDER BY event_on ASC`,
    [range.startOn, range.endOn, generatedOn],
  );

  const [actualRows] = await connection.execute<ActualRow[]>(
    `SELECT DATE_FORMAT(t.occurred_on, '%Y-%m-%d') AS event_on,
            COUNT(DISTINCT CASE
              WHEN BINARY t.transaction_type IN (BINARY 'income', BINARY 'expense')
              THEN t.id
              ELSE NULL
            END) AS entry_count,
            CAST(COALESCE(SUM(CASE
              WHEN BINARY t.transaction_type = BINARY 'income'
                AND BINARY le.entry_side = BINARY 'inflow' THEN le.amount
              ELSE 0.0000
            END), 0.0000) AS DECIMAL(65,4)) AS inflow_amount,
            CAST(COALESCE(SUM(CASE
              WHEN BINARY t.transaction_type = BINARY 'expense'
                AND BINARY le.entry_side = BINARY 'outflow' THEN le.amount
              ELSE 0.0000
            END), 0.0000) AS DECIMAL(65,4)) AS outflow_amount
       FROM finance_transaction t
       JOIN finance_ledger_entry le ON le.transaction_id = t.id
      WHERE t.occurred_on >= ? AND t.occurred_on <= ?
        AND t.occurred_on <= ?
      GROUP BY t.occurred_on
     HAVING inflow_amount <> 0.0000 OR outflow_amount <> 0.0000
      ORDER BY t.occurred_on ASC`,
    [range.startOn, range.endOn, generatedOn],
  );

  const [forecastRows] = await connection.execute<ForecastRow[]>(
    `SELECT forecast.event_on, forecast.kind, forecast.direction, forecast.bucket,
            COUNT(*) AS entry_count,
            COALESCE(SUM(forecast.amount), 0.0000) AS amount
       FROM (
         SELECT r.due_on AS event_on,
                'customer_receivable' AS kind, 'inflow' AS direction,
                CASE WHEN r.due_on < ? THEN 'overdue' ELSE 'scheduled' END AS bucket,
                GREATEST(r.total_amount - COALESCE(rc.collected_amount, 0.0000), 0.0000) AS amount
           FROM receivable r
           LEFT JOIN (
             SELECT receivable_id,
                    SUM(CASE WHEN entry_type = 'reversal' THEN -amount ELSE amount END) AS collected_amount
               FROM receivable_collection
              GROUP BY receivable_id
           ) rc ON rc.receivable_id = r.id
          WHERE r.record_state = 'active'
            AND (r.due_on < ? OR (r.due_on >= ? AND r.due_on <= ?))
            AND r.total_amount - COALESCE(rc.collected_amount, 0.0000) > 0
         UNION ALL
         SELECT pc.due_on, 'partner_contribution', 'inflow',
                CASE WHEN pc.due_on < ? THEN 'overdue' ELSE 'scheduled' END,
                pc.expected_amount - pc.received_amount
          FROM partnership_contribution pc
          WHERE pc.status IN ('expected', 'partial')
            AND (pc.due_on < ? OR (pc.due_on >= ? AND pc.due_on <= ?))
            AND pc.expected_amount - pc.received_amount > 0
         UNION ALL
         SELECT cci.due_on, 'card_installment', 'outflow',
                CASE WHEN cci.due_on < ? THEN 'overdue' ELSE 'scheduled' END,
                cci.amount
           FROM credit_card_installment cci
          JOIN expense e ON e.id = cci.expense_id
          WHERE e.status = 'active' AND cci.status = 'planned'
            AND (cci.due_on < ? OR (cci.due_on >= ? AND cci.due_on <= ?))
         UNION ALL
         SELECT e.incurred_on, 'direct_expense', 'outflow', 'scheduled', e.total_amount
           FROM expense e
          WHERE e.status = 'active'
            AND e.payment_method IN ('cash', 'bank_transfer')
            AND e.incurred_on >= ? AND e.incurred_on <= ?
            AND e.incurred_on > ?
         UNION ALL
         SELECT NULL, 'commission_receivable', 'inflow', 'undated', pc.share_amount
           FROM partnership_commission pc
          WHERE pc.status = 'agency_collected'
       ) forecast
      GROUP BY forecast.event_on, forecast.kind, forecast.direction, forecast.bucket
      ORDER BY forecast.event_on IS NULL ASC, forecast.event_on ASC,
               forecast.direction ASC, forecast.kind ASC`,
    [
      generatedOn,
      generatedOn,
      range.startOn,
      range.endOn,
      generatedOn,
      generatedOn,
      range.startOn,
      range.endOn,
      generatedOn,
      generatedOn,
      range.startOn,
      range.endOn,
      range.startOn,
      range.endOn,
      generatedOn,
    ],
  );

  const [unclassifiedRows] = await connection.execute<UnclassifiedRow[]>(
    `SELECT COUNT(*) AS entry_count,
            COALESCE(SUM(e.total_amount), 0.0000) AS amount
       FROM expense e
      WHERE e.status = 'active' AND e.payment_method = 'other'
        AND e.incurred_on >= ? AND e.incurred_on <= ?
        AND e.incurred_on <= ?`,
    [range.startOn, range.endOn, generatedOn],
  );
  const unclassified = unclassifiedRows[0];
  if (!unclassified) throw new Error("Cash flow unclassified aggregate is missing.");

  return {
    accountOpenings: accountOpeningRows.map((row) => ({
      accountCount: count(row.account_count),
      amount: money(row.amount),
      eventOn: canonicalDate(row.event_on),
    })),
    actual: actualRows.map((row) => ({
      entryCount: count(row.entry_count),
      eventOn: canonicalDate(row.event_on),
      inflowAmount: money(row.inflow_amount),
      outflowAmount: money(row.outflow_amount),
    })),
    balance: {
      accountCount: count(balance.account_count),
      closingBalanceAmount: money(balance.closing_balance_amount),
      openingBalanceAmount: money(balance.opening_balance_amount),
    },
    forecast: forecastRows.map((row) => ({
      amount: money(row.amount),
      bucket: bucket(row.bucket),
      direction: direction(row.direction),
      entryCount: count(row.entry_count),
      eventOn: row.event_on === null ? null : canonicalDate(row.event_on),
      kind: forecastKind(row.kind),
    })),
    unclassifiedExpenseAmount: money(unclassified.amount),
    unclassifiedExpenseCount: count(unclassified.entry_count),
  };
}
