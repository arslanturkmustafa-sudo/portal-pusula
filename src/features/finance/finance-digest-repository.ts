import "server-only";

import Decimal from "decimal.js";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { buildCardInstallmentPlan } from "@/features/finance/card-plan";
import {
  occurrenceDatesInRange,
  type RecurrenceFrequency,
} from "@/platform/recurrence/schedule";

export type FinanceDigestItem = Readonly<{
  direction: "inflow" | "outflow";
  dueOn: string;
  label: string;
  remainingAmount: string;
  sourceLabel: string | null;
}>;

type DueRow = RowDataPacket & {
  direction: string;
  due_on: string | Date;
  label: string;
  remaining_amount: string;
  source_label: string | null;
};

type RecurringExpenseRow = RowDataPacket & {
  anchor_day: number | string;
  credit_card_label: string | null;
  description: string;
  ends_on: string | Date | null;
  frequency: string;
  next_due_on: string | Date;
  payment_due_day: number | string | null;
  payment_method: string;
  statement_closing_day: number | string | null;
  total_amount: string;
};

function canonicalDate(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function money(value: string): string {
  return new Decimal(value).toFixed(4);
}

function direction(value: string): FinanceDigestItem["direction"] {
  if (value !== "inflow" && value !== "outflow") {
    throw new Error("Finance digest direction is invalid.");
  }
  return value;
}

function recurringFrequency(
  value: string,
): Extract<RecurrenceFrequency, "monthly" | "weekly"> {
  if (value !== "monthly" && value !== "weekly") {
    throw new Error("Finance digest recurrence frequency is invalid.");
  }
  return value;
}

function recurringDay(value: number | string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new Error(`Finance digest ${field} is invalid.`);
  }
  return parsed;
}

function recurringCashDueOn(
  row: RecurringExpenseRow,
  occurrenceOn: string,
): string {
  if (row.payment_method !== "credit_card") return occurrenceOn;

  const [installment] = buildCardInstallmentPlan({
    incurredOn: occurrenceOn,
    installmentCount: 1,
    paymentDueDay: recurringDay(row.payment_due_day ?? 0, "payment due day"),
    statementClosingDay: recurringDay(
      row.statement_closing_day ?? 0,
      "statement closing day",
    ),
    totalAmount: money(row.total_amount),
  });
  if (!installment) throw new Error("Finance digest card due date is missing.");
  return installment.dueOn;
}

/**
 * Reads only currently open receivables/payables whose due date has arrived.
 * It intentionally avoids the balance, forecast and reconciliation work used by
 * the full cash-flow report because the morning digest does not need it.
 */
export async function listOpenFinanceDigestItems(
  connection: PoolConnection,
  businessDate: string,
): Promise<readonly FinanceDigestItem[]> {
  const [rows] = await connection.execute<DueRow[]>(
    `SELECT due_item.due_on, due_item.label, due_item.source_label,
            due_item.direction, due_item.remaining_amount
       FROM (
         SELECT receivable.due_on, receivable.description AS label,
                customer.display_name AS source_label,
                'inflow' AS direction,
                CAST(GREATEST(
                  receivable.total_amount -
                    COALESCE(collection.collected_amount, 0.0000),
                  0.0000
                ) AS DECIMAL(65,4)) AS remaining_amount
           FROM receivable receivable
           JOIN customer customer ON customer.id = receivable.customer_id
           LEFT JOIN (
             SELECT receivable_id,
                    SUM(CASE WHEN entry_type = 'reversal' THEN -amount ELSE amount END)
                      AS collected_amount
               FROM receivable_collection
              WHERE collected_on <= ?
              GROUP BY receivable_id
           ) collection ON collection.receivable_id = receivable.id
          WHERE receivable.record_state = 'active'
            AND receivable.due_on <= ?
            AND receivable.total_amount -
                COALESCE(collection.collected_amount, 0.0000) > 0
         UNION ALL
         SELECT contribution.due_on, contribution.description,
                project.display_name, 'inflow',
                CAST(GREATEST(
                  contribution.expected_amount - contribution.received_amount,
                  0.0000
                ) AS DECIMAL(65,4))
           FROM partnership_contribution contribution
           JOIN project project ON project.id = contribution.project_id
          WHERE contribution.status IN ('expected', 'partial')
            AND contribution.due_on <= ?
            AND contribution.expected_amount - contribution.received_amount > 0
         UNION ALL
         SELECT installment.due_on,
                CONCAT(card.display_name, ' kart borcu'),
                card.bank_name, 'outflow',
                CAST(SUM(installment.amount) AS DECIMAL(65,4))
           FROM credit_card_installment installment
           JOIN expense expense ON expense.id = installment.expense_id
           JOIN credit_card card ON card.id = expense.credit_card_id
          WHERE expense.status = 'active'
            AND installment.status = 'planned'
            AND installment.due_on <= ?
          GROUP BY installment.due_on, card.id, card.display_name, card.bank_name
         UNION ALL
         SELECT tax.due_on,
                CASE BINARY tax.tax_type
                  WHEN BINARY 'vat' THEN 'KDV'
                  WHEN BINARY 'income_tax' THEN 'Gelir vergisi'
                  WHEN BINARY 'provisional_tax' THEN 'Geçici vergi'
                END,
                DATE_FORMAT(tax.period_month, '%Y-%m'),
                'outflow', CAST(tax.payable_amount AS DECIMAL(65,4))
           FROM tax_obligation tax
          WHERE BINARY tax.status = BINARY 'planned'
            AND tax.payable_amount > 0
            AND tax.due_on <= ?
       ) due_item
      ORDER BY due_item.due_on ASC, due_item.direction ASC,
               due_item.label ASC`,
    [businessDate, businessDate, businessDate, businessDate, businessDate],
  );

  const [recurringRows] = await connection.execute<RecurringExpenseRow[]>(
    `SELECT recurring.description, recurring.total_amount,
            recurring.payment_method, recurring.frequency,
            recurring.anchor_day, recurring.next_due_on, recurring.ends_on,
            card.display_name AS credit_card_label,
            card.statement_closing_day, card.payment_due_day
       FROM recurring_expense recurring
       LEFT JOIN credit_card card ON card.id = recurring.credit_card_id
      WHERE BINARY recurring.status = BINARY 'active'
        AND recurring.next_due_on <= ?
        AND (recurring.ends_on IS NULL OR recurring.next_due_on <= recurring.ends_on)
      ORDER BY recurring.next_due_on ASC, recurring.id ASC`,
    [businessDate],
  );

  const items: FinanceDigestItem[] = rows.map((row) => ({
    direction: direction(row.direction),
    dueOn: canonicalDate(row.due_on),
    label: row.label,
    remainingAmount: money(row.remaining_amount),
    sourceLabel: row.source_label,
  }));

  for (const row of recurringRows) {
    const firstOn = canonicalDate(row.next_due_on);
    for (const occurrenceOn of occurrenceDatesInRange({
      anchorDay: recurringDay(row.anchor_day, "recurrence anchor day"),
      endsOn: row.ends_on === null ? null : canonicalDate(row.ends_on),
      firstOn,
      frequency: recurringFrequency(row.frequency),
      from: firstOn,
      to: businessDate,
    })) {
      const dueOn = recurringCashDueOn(row, occurrenceOn);
      if (dueOn > businessDate) continue;
      items.push({
        direction: "outflow",
        dueOn,
        label: row.description,
        remainingAmount: money(row.total_amount),
        sourceLabel: row.credit_card_label,
      });
    }
  }

  return items.sort(
    (left, right) =>
      left.dueOn.localeCompare(right.dueOn) ||
      left.direction.localeCompare(right.direction) ||
      left.label.localeCompare(right.label, "tr"),
  );
}
