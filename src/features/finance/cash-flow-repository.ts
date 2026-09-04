import "server-only";

import Decimal from "decimal.js";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export type CashFlowDirection = "inflow" | "outflow";
export type CashFlowActualKind =
  | "card_installment"
  | "commission_payment"
  | "customer_collection"
  | "direct_expense"
  | "partner_contribution";
export type CashFlowForecastKind =
  | "card_installment"
  | "commission_receivable"
  | "customer_receivable"
  | "direct_expense"
  | "partner_contribution";
export type CashFlowForecastBucket = "overdue" | "scheduled" | "undated";

export type CashFlowActualAggregate = Readonly<{
  amount: string;
  direction: CashFlowDirection;
  entryCount: number;
  kind: CashFlowActualKind;
}>;

export type CashFlowForecastAggregate = Readonly<{
  amount: string;
  bucket: CashFlowForecastBucket;
  direction: CashFlowDirection;
  entryCount: number;
  kind: CashFlowForecastKind;
}>;

export type CashFlowLedgerSnapshot = Readonly<{
  actual: readonly CashFlowActualAggregate[];
  forecast: readonly CashFlowForecastAggregate[];
  unclassifiedExpenseAmount: string;
  unclassifiedExpenseCount: number;
}>;

type ActualRow = RowDataPacket & {
  amount: string;
  direction: string;
  entry_count: number | string;
  kind: string;
};

type ForecastRow = ActualRow & { bucket: string };

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

function direction(value: string): CashFlowDirection {
  if (value !== "inflow" && value !== "outflow") {
    throw new Error("Cash flow direction is invalid.");
  }
  return value;
}

function actualKind(value: string): CashFlowActualKind {
  if (
    value !== "card_installment" &&
    value !== "commission_payment" &&
    value !== "customer_collection" &&
    value !== "direct_expense" &&
    value !== "partner_contribution"
  ) {
    throw new Error("Cash flow actual kind is invalid.");
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
  range: Readonly<{ monthStart: string; nextMonthStart: string }>,
  generatedOn: string,
): Promise<CashFlowLedgerSnapshot> {
  const [actualRows] = await connection.execute<ActualRow[]>(
    `SELECT event.kind, event.direction, COUNT(*) AS entry_count,
            COALESCE(SUM(event.amount), 0.0000) AS amount
       FROM (
         SELECT 'customer_collection' AS kind,
                CASE WHEN rc.entry_type = 'reversal' THEN 'outflow' ELSE 'inflow' END AS direction,
                rc.amount AS amount
           FROM receivable_collection rc
          WHERE rc.collected_on >= ? AND rc.collected_on < ?
            AND rc.collected_on <= ?
         UNION ALL
         SELECT 'partner_contribution',
                CASE WHEN pcr.entry_type = 'reversal' THEN 'outflow' ELSE 'inflow' END,
                pcr.amount
           FROM partnership_contribution_receipt pcr
          WHERE pcr.received_on >= ? AND pcr.received_on < ?
            AND pcr.received_on <= ?
         UNION ALL
         SELECT 'commission_payment', 'inflow', pc.share_amount
           FROM partnership_commission pc
          WHERE pc.status = 'paid' AND pc.paid_on IS NOT NULL
            AND pc.paid_on >= ? AND pc.paid_on < ? AND pc.paid_on <= ?
         UNION ALL
         SELECT 'direct_expense', 'outflow', e.total_amount
           FROM expense e
          WHERE e.status = 'active'
            AND e.payment_method IN ('cash', 'bank_transfer')
            AND e.incurred_on >= ? AND e.incurred_on < ?
            AND e.incurred_on <= ?
         UNION ALL
         SELECT 'card_installment', 'outflow', cci.amount
           FROM credit_card_installment cci
           JOIN expense e ON e.id = cci.expense_id
          WHERE e.status = 'active' AND cci.status = 'paid'
            AND cci.paid_on IS NOT NULL
            AND cci.paid_on >= ? AND cci.paid_on < ? AND cci.paid_on <= ?
       ) event
      GROUP BY event.kind, event.direction
      ORDER BY event.direction ASC, event.kind ASC`,
    [
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
    ],
  );

  const [forecastRows] = await connection.execute<ForecastRow[]>(
    `SELECT forecast.kind, forecast.direction, forecast.bucket,
            COUNT(*) AS entry_count,
            COALESCE(SUM(forecast.amount), 0.0000) AS amount
       FROM (
         SELECT 'customer_receivable' AS kind, 'inflow' AS direction,
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
            AND r.due_on >= ? AND r.due_on < ?
            AND r.total_amount - COALESCE(rc.collected_amount, 0.0000) > 0
         UNION ALL
         SELECT 'partner_contribution', 'inflow',
                CASE WHEN pc.due_on < ? THEN 'overdue' ELSE 'scheduled' END,
                pc.expected_amount - pc.received_amount
           FROM partnership_contribution pc
          WHERE pc.status IN ('expected', 'partial')
            AND pc.due_on >= ? AND pc.due_on < ?
            AND pc.expected_amount - pc.received_amount > 0
         UNION ALL
         SELECT 'card_installment', 'outflow',
                CASE WHEN cci.due_on < ? THEN 'overdue' ELSE 'scheduled' END,
                cci.amount
           FROM credit_card_installment cci
           JOIN expense e ON e.id = cci.expense_id
          WHERE e.status = 'active' AND cci.status = 'planned'
            AND cci.due_on >= ? AND cci.due_on < ?
         UNION ALL
         SELECT 'direct_expense', 'outflow', 'scheduled', e.total_amount
           FROM expense e
          WHERE e.status = 'active'
            AND e.payment_method IN ('cash', 'bank_transfer')
            AND e.incurred_on >= ? AND e.incurred_on < ?
            AND e.incurred_on > ?
         UNION ALL
         SELECT 'commission_receivable', 'inflow', 'undated', pc.share_amount
           FROM partnership_commission pc
          WHERE pc.status = 'agency_collected'
       ) forecast
      GROUP BY forecast.kind, forecast.direction, forecast.bucket
      ORDER BY FIELD(forecast.bucket, 'scheduled', 'overdue', 'undated'),
               forecast.direction ASC, forecast.kind ASC`,
    [
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      generatedOn,
    ],
  );

  const [unclassifiedRows] = await connection.execute<UnclassifiedRow[]>(
    `SELECT COUNT(*) AS entry_count,
            COALESCE(SUM(e.total_amount), 0.0000) AS amount
       FROM expense e
      WHERE e.status = 'active' AND e.payment_method = 'other'
        AND e.incurred_on >= ? AND e.incurred_on < ?
        AND e.incurred_on <= ?`,
    [range.monthStart, range.nextMonthStart, generatedOn],
  );
  const unclassified = unclassifiedRows[0];
  if (!unclassified) throw new Error("Cash flow unclassified aggregate is missing.");

  return {
    actual: actualRows.map((row) => ({
      amount: money(row.amount),
      direction: direction(row.direction),
      entryCount: count(row.entry_count),
      kind: actualKind(row.kind),
    })),
    forecast: forecastRows.map((row) => ({
      amount: money(row.amount),
      bucket: bucket(row.bucket),
      direction: direction(row.direction),
      entryCount: count(row.entry_count),
      kind: forecastKind(row.kind),
    })),
    unclassifiedExpenseAmount: money(unclassified.amount),
    unclassifiedExpenseCount: count(unclassified.entry_count),
  };
}
