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
  | "partner_contribution"
  | "tax_payment";
export type CashFlowForecastBucket = "overdue" | "scheduled" | "undated";

export type CashFlowDueItemKind =
  | "card_payment"
  | "customer_receivable"
  | "other_expense"
  | "partner_contribution"
  | "tax_payment";

export type CashFlowDueItem = Readonly<{
  direction: CashFlowDirection;
  dueOn: string;
  id: string;
  kind: CashFlowDueItemKind;
  label: string;
  remainingAmount: string;
  settledAmount: string;
  sourceLabel: string | null;
  status:
    | "actual"
    | "overdue"
    | "partial"
    | "planned"
    | "scheduled"
    | "settled";
  totalAmount: string;
}>;

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
  currentAssetAmount: string;
  openingBalanceAmount: string;
}>;

export type CashFlowLedgerSnapshot = Readonly<{
  accountOpenings: readonly CashFlowAccountOpeningDailyAggregate[];
  actual: readonly CashFlowActualDailyAggregate[];
  balance: CashFlowBalanceSnapshot;
  dueItems: readonly CashFlowDueItem[];
  forecast: readonly CashFlowForecastAggregate[];
  unclassifiedExpenseAmount: string;
  unclassifiedExpenseCount: number;
}>;

type BalanceRow = RowDataPacket & {
  account_count: number | string;
  closing_balance_amount: string;
  current_asset_amount: string;
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

type DueItemRow = RowDataPacket & {
  direction: string;
  due_on: string | Date;
  id: string;
  kind: string;
  label: string;
  remaining_amount: string;
  settled_amount: string;
  source_label: string | null;
  status: string;
  total_amount: string;
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
    value !== "partner_contribution" &&
    value !== "tax_payment"
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

function dueItemKind(value: string): CashFlowDueItemKind {
  if (
    value !== "card_payment" &&
    value !== "customer_receivable" &&
    value !== "other_expense" &&
    value !== "partner_contribution" &&
    value !== "tax_payment"
  ) {
    throw new Error("Cash flow due item kind is invalid.");
  }
  return value;
}

function dueItemStatus(
  value: string,
): CashFlowDueItem["status"] {
  if (
    value !== "actual" &&
    value !== "overdue" &&
    value !== "partial" &&
    value !== "planned" &&
    value !== "scheduled" &&
    value !== "settled"
  ) {
    throw new Error("Cash flow due item status is invalid.");
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
       ) AS closing_balance_amount,
       CAST(
         COALESCE((
           SELECT SUM(a.opening_balance_amount)
             FROM finance_account a
            WHERE DATE(CONVERT_TZ(a.created_at_utc, '+00:00', '+03:00')) <= ?
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
              WHERE t.occurred_on <= ?
           ), 0.0000)
         AS DECIMAL(65,4)
       ) AS current_asset_amount`,
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
      generatedOn,
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
         SELECT tax_forecast.due_on, 'tax_payment', 'outflow',
                CASE
                  WHEN tax_forecast.due_on < ? THEN 'overdue'
                  ELSE 'scheduled'
                END,
                tax_forecast.payable_amount
           FROM tax_obligation tax_forecast
          WHERE BINARY tax_forecast.status = BINARY 'planned'
            AND tax_forecast.payable_amount > 0
            AND (
              tax_forecast.due_on < ?
              OR (tax_forecast.due_on >= ? AND tax_forecast.due_on <= ?)
            )
         UNION ALL
         SELECT e.incurred_on, 'direct_expense', 'outflow', 'scheduled', e.total_amount
           FROM expense e
          WHERE e.status = 'active'
            AND e.payment_method IN ('cash', 'bank_transfer', 'other')
            AND e.finance_transaction_id IS NULL
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
      generatedOn,
      generatedOn,
      range.startOn,
      range.endOn,
      range.startOn,
      range.endOn,
      generatedOn,
    ],
  );

  const [dueItemRows] = await connection.execute<DueItemRow[]>(
    `SELECT due_item.id, due_item.due_on, due_item.label,
            due_item.source_label, due_item.status, due_item.direction,
            due_item.total_amount, due_item.settled_amount,
            due_item.remaining_amount, due_item.kind
       FROM (
         SELECT CONCAT('receivable:', receivable.id) AS id,
                receivable.due_on, receivable.description AS label,
                CONCAT_WS(
                  ' · ', customer.display_name, project.display_name
                ) AS source_label,
                CASE
                  WHEN receivable.total_amount -
                       COALESCE(collection.collected_amount, 0.0000) <= 0
                    THEN 'settled'
                  WHEN receivable.due_on < ? THEN 'overdue'
                  WHEN COALESCE(collection.collected_amount, 0.0000) > 0
                    THEN 'partial'
                  ELSE 'planned'
                END AS status,
                'inflow' AS direction,
                CAST(receivable.total_amount AS DECIMAL(65,4)) AS total_amount,
                CAST(LEAST(
                  receivable.total_amount,
                  GREATEST(COALESCE(collection.collected_amount, 0.0000), 0.0000)
                ) AS DECIMAL(65,4)) AS settled_amount,
                CAST(GREATEST(
                  receivable.total_amount - COALESCE(collection.collected_amount, 0.0000),
                  0.0000
                ) AS DECIMAL(65,4)) AS remaining_amount,
                'customer_receivable' AS kind
           FROM receivable receivable
           JOIN customer customer ON customer.id = receivable.customer_id
           LEFT JOIN project project ON project.id = receivable.project_id
           LEFT JOIN (
             SELECT receivable_id,
                    SUM(CASE WHEN entry_type = 'reversal' THEN -amount ELSE amount END)
                      AS collected_amount
               FROM receivable_collection
              WHERE collected_on <= ?
              GROUP BY receivable_id
           ) collection ON collection.receivable_id = receivable.id
          WHERE receivable.record_state = 'active'
            AND (
              (receivable.due_on >= ? AND receivable.due_on <= ?)
              OR (
                receivable.due_on < ? AND receivable.due_on < ?
                AND receivable.total_amount -
                    COALESCE(collection.collected_amount, 0.0000) > 0
              )
            )
         UNION ALL
         SELECT CONCAT('partner_contribution:', contribution.id),
                contribution.due_on, contribution.description,
                project.display_name,
                CASE
                  WHEN contribution.expected_amount - contribution.received_amount <= 0
                    THEN 'settled'
                  WHEN contribution.due_on < ? THEN 'overdue'
                  WHEN contribution.received_amount > 0 THEN 'partial'
                  ELSE 'planned'
                END,
                'inflow',
                CAST(contribution.expected_amount AS DECIMAL(65,4)),
                CAST(contribution.received_amount AS DECIMAL(65,4)),
                CAST(GREATEST(
                  contribution.expected_amount - contribution.received_amount,
                  0.0000
                ) AS DECIMAL(65,4)),
                'partner_contribution'
           FROM partnership_contribution contribution
           JOIN project project ON project.id = contribution.project_id
          WHERE contribution.status <> 'cancelled'
            AND (
              (contribution.due_on >= ? AND contribution.due_on <= ?)
              OR (
                contribution.due_on < ? AND contribution.due_on < ?
                AND contribution.expected_amount - contribution.received_amount > 0
              )
            )
         UNION ALL
         SELECT CONCAT(
                  'card_payment:', card_due.card_id, ':',
                  DATE_FORMAT(card_due.due_on, '%Y-%m-%d')
                ),
                card_due.due_on,
                CONCAT(card_due.display_name, ' kart borcu'),
                card_due.bank_name,
                CASE
                  WHEN card_due.total_amount - card_due.settled_amount <= 0
                    THEN 'settled'
                  WHEN card_due.due_on < ? THEN 'overdue'
                  WHEN card_due.settled_amount > 0 THEN 'partial'
                  ELSE 'planned'
                END,
                'outflow',
                CAST(card_due.total_amount AS DECIMAL(65,4)),
                CAST(card_due.settled_amount AS DECIMAL(65,4)),
                CAST(GREATEST(
                  card_due.total_amount - card_due.settled_amount,
                  0.0000
                ) AS DECIMAL(65,4)),
                'card_payment'
           FROM (
             SELECT card.id AS card_id, card.display_name, card.bank_name,
                    installment.due_on,
                    SUM(installment.amount) AS total_amount,
                    SUM(CASE
                      WHEN installment.status = 'paid' AND installment.paid_on <= ?
                        THEN installment.amount
                      ELSE 0.0000
                    END) AS settled_amount
               FROM credit_card_installment installment
               JOIN expense expense ON expense.id = installment.expense_id
               JOIN credit_card card ON card.id = expense.credit_card_id
              WHERE expense.status = 'active'
                AND (
                  (installment.due_on >= ? AND installment.due_on <= ?)
                  OR (
                    installment.due_on < ? AND installment.due_on < ?
                  )
                )
              GROUP BY card.id, card.display_name, card.bank_name,
                       installment.due_on
           ) card_due
         WHERE card_due.due_on >= ?
             OR card_due.total_amount - card_due.settled_amount > 0
         UNION ALL
         SELECT CONCAT('tax_payment:', tax_due.id),
                tax_due.due_on,
                CASE BINARY tax_due.tax_type
                  WHEN BINARY 'vat' THEN 'KDV'
                  WHEN BINARY 'income_tax' THEN 'Gelir vergisi'
                  WHEN BINARY 'provisional_tax' THEN 'Geçici vergi'
                END,
                DATE_FORMAT(tax_due.period_month, '%Y-%m'),
                CASE
                  WHEN BINARY tax_due.status = BINARY 'paid' THEN 'settled'
                  WHEN tax_due.due_on < ? THEN 'overdue'
                  ELSE 'planned'
                END,
                'outflow',
                CAST(tax_due.payable_amount AS DECIMAL(65,4)),
                CAST(CASE
                  WHEN BINARY tax_due.status = BINARY 'paid'
                    THEN tax_due.payable_amount
                  ELSE 0.0000
                END AS DECIMAL(65,4)),
                CAST(CASE
                  WHEN BINARY tax_due.status = BINARY 'paid' THEN 0.0000
                  ELSE tax_due.payable_amount
                END AS DECIMAL(65,4)),
                'tax_payment'
           FROM tax_obligation tax_due
          WHERE BINARY tax_due.status <> BINARY 'voided'
            AND tax_due.payable_amount > 0
            AND (
              (tax_due.due_on >= ? AND tax_due.due_on <= ?)
              OR (
                BINARY tax_due.status = BINARY 'planned'
                AND tax_due.due_on < ? AND tax_due.due_on < ?
              )
            )
         UNION ALL
         SELECT CONCAT(
                  'other_expense:', expense.category, ':',
                  DATE_FORMAT(expense.incurred_on, '%Y-%m-%d')
                ),
                expense.incurred_on,
                CONCAT(
                  COALESCE(category.display_name, expense.category),
                  ' · ', COUNT(*), ' kayıt'
                ),
                NULL,
                'scheduled',
                'outflow',
                CAST(SUM(expense.total_amount) AS DECIMAL(65,4)),
                CAST(0.0000 AS DECIMAL(65,4)),
                CAST(SUM(expense.total_amount) AS DECIMAL(65,4)),
                'other_expense'
           FROM expense expense
           LEFT JOIN expense_category category ON category.code = expense.category
          WHERE expense.status = 'active'
            AND expense.payment_method IN ('cash', 'bank_transfer', 'other')
            AND expense.finance_transaction_id IS NULL
            AND expense.incurred_on >= ? AND expense.incurred_on <= ?
            AND expense.incurred_on > ?
          GROUP BY expense.category, category.display_name, expense.incurred_on
       ) due_item
      ORDER BY due_item.due_on ASC, due_item.status ASC,
               due_item.direction ASC, due_item.kind ASC, due_item.id ASC`,
    [
      // Customer receivable: status date, collection cut-off, range/carry-over.
      generatedOn,
      generatedOn,
      range.startOn,
      range.endOn,
      range.startOn,
      generatedOn,
      // Partner contribution: status date and range/carry-over.
      generatedOn,
      range.startOn,
      range.endOn,
      range.startOn,
      generatedOn,
      // Card total: status date, payment cut-off, range/carry-over.
      generatedOn,
      generatedOn,
      range.startOn,
      range.endOn,
      range.startOn,
      generatedOn,
      range.startOn,
      // Tax obligation: due-based status and selected range/open carry-over.
      generatedOn,
      range.startOn,
      range.endOn,
      range.startOn,
      generatedOn,
      // Aggregated non-card expense: only future-dated planned obligations.
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
      currentAssetAmount: money(balance.current_asset_amount),
      openingBalanceAmount: money(balance.opening_balance_amount),
    },
    dueItems: dueItemRows.map((row) => ({
      direction: direction(row.direction),
      dueOn: canonicalDate(row.due_on),
      id: row.id,
      kind: dueItemKind(row.kind),
      label: row.label,
      remainingAmount: money(row.remaining_amount),
      settledAmount: money(row.settled_amount),
      sourceLabel: row.source_label,
      status: dueItemStatus(row.status),
      totalAmount: money(row.total_amount),
    })),
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
