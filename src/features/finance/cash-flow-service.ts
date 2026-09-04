import "server-only";

import Decimal from "decimal.js";
import type { Pool } from "mysql2/promise";

import {
  readCashFlowLedger,
  type CashFlowActualAggregate,
  type CashFlowForecastAggregate,
  type CashFlowLedgerSnapshot,
} from "@/features/finance/cash-flow-repository";
import {
  cashFlowFilterSchema,
  type CashFlowFilter,
} from "@/features/finance/cash-flow-validation";
import { istanbulDate, monthBounds } from "@/features/finance/period";
import { withUtcConsistentRead } from "@/platform/jobs/mysql-transaction";

type CashFlowTotals = Readonly<{
  inflowAmount: string;
  netAmount: string;
  outflowAmount: string;
}>;

export type CashFlowReport = Readonly<{
  actual: CashFlowTotals & Readonly<{ lines: readonly CashFlowActualAggregate[] }>;
  assumptions: readonly string[];
  balanceStatus: "not_configured";
  forecast: Readonly<{
    lines: readonly CashFlowForecastAggregate[];
    overdue: CashFlowTotals;
    scheduled: CashFlowTotals;
    undatedInflowAmount: string;
  }>;
  generatedOn: string;
  month: string;
  unclassifiedExpenses: Readonly<{ amount: string; entryCount: number }>;
}>;

function totals(
  lines: readonly Readonly<{ amount: string; direction: "inflow" | "outflow" }>[],
): CashFlowTotals {
  const inflow = lines
    .filter((line) => line.direction === "inflow")
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0));
  const outflow = lines
    .filter((line) => line.direction === "outflow")
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0));
  return {
    inflowAmount: inflow.toFixed(4),
    netAmount: inflow.minus(outflow).toFixed(4),
    outflowAmount: outflow.toFixed(4),
  };
}

export function composeCashFlowReport(
  snapshot: CashFlowLedgerSnapshot,
  month: string,
  generatedOn: string,
): CashFlowReport {
  const scheduled = snapshot.forecast.filter((line) => line.bucket === "scheduled");
  const overdue = snapshot.forecast.filter((line) => line.bucket === "overdue");
  const undatedInflowAmount = snapshot.forecast
    .filter((line) => line.bucket === "undated" && line.direction === "inflow")
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
    .toFixed(4);
  return {
    actual: { lines: snapshot.actual, ...totals(snapshot.actual) },
    assumptions: [
      "Nakit ve havale giderlerinde işlem tarihi, ödeme tarihi vekili olarak kullanılır.",
      "Kartlı giderler yalnız ödenmiş taksit tarihinde çıkış sayılır; gider toplamı ayrıca sayılmaz.",
      "Tahakkuklar, gerçekleşen hareketlerden ayrı tutulur; açılış ve kapanış bakiyesi üretilmez.",
    ],
    balanceStatus: "not_configured",
    forecast: {
      lines: snapshot.forecast,
      overdue: totals(overdue),
      scheduled: totals(scheduled),
      undatedInflowAmount,
    },
    generatedOn,
    month,
    unclassifiedExpenses: {
      amount: snapshot.unclassifiedExpenseAmount,
      entryCount: snapshot.unclassifiedExpenseCount,
    },
  };
}

export async function getCashFlowReport(
  pool: Pool,
  rawFilter: CashFlowFilter,
  now = new Date(),
): Promise<CashFlowReport> {
  const { month } = cashFlowFilterSchema.parse(rawFilter);
  const generatedOn = istanbulDate(now);
  const range = monthBounds(month);
  return withUtcConsistentRead(pool, async (connection) =>
    composeCashFlowReport(
      await readCashFlowLedger(connection, range, generatedOn),
      month,
      generatedOn,
    ),
  );
}
