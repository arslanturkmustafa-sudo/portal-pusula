import "server-only";

import Decimal from "decimal.js";
import type { Pool } from "mysql2/promise";

import { FinanceLedgerIntegrityError } from "@/features/finance/account-repository";
import {
  readCashFlowLedger,
  type CashFlowAccountOpeningDailyAggregate,
  type CashFlowActualDailyAggregate,
  type CashFlowForecastAggregate,
  type CashFlowLedgerSnapshot,
} from "@/features/finance/cash-flow-repository";
import {
  cashFlowFilterSchema,
  type CashFlowFilter,
  type CashFlowGranularity,
} from "@/features/finance/cash-flow-validation";
import { istanbulDate } from "@/features/finance/period";
import { withUtcConsistentRead } from "@/platform/jobs/mysql-transaction";

export type CashFlowTotals = Readonly<{
  inflowAmount: string;
  netAmount: string;
  outflowAmount: string;
}>;

export type CashFlowPeriodReport = Readonly<{
  accountOpeningAmount: string;
  actual: CashFlowTotals & Readonly<{ entryCount: number }>;
  closingBalanceAmount: string;
  endOn: string;
  forecast: Readonly<{
    overdue: CashFlowTotals;
    scheduled: CashFlowTotals;
  }>;
  openingBalanceAmount: string;
  startOn: string;
}>;

export type CashFlowReport = Readonly<{
  actual: CashFlowTotals & Readonly<{ entryCount: number }>;
  assumptions: readonly string[];
  balance: Readonly<{
    accountOpeningAmount: string;
    accountCount: number;
    asOfOn: string;
    closingBalanceAmount: string;
    openingBalanceAmount: string;
    status: "configured" | "not_configured";
  }>;
  forecast: Readonly<{
    lines: readonly CashFlowForecastAggregate[];
    overdue: CashFlowTotals;
    overdueInRange: CashFlowTotals;
    scheduled: CashFlowTotals;
    undatedInflowAmount: string;
  }>;
  generatedOn: string;
  granularity: CashFlowGranularity;
  periods: readonly CashFlowPeriodReport[];
  range: Readonly<{ from: string; to: string }>;
  unclassifiedExpenses: Readonly<{ amount: string; entryCount: number }>;
}>;

type PeriodBounds = Readonly<{ endOn: string; startOn: string }>;

function dateFromIso(value: string): Date {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
    ),
  );
}

function isoFromDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromDate(date);
}

function endOfCalendarWeek(value: string): string {
  const date = dateFromIso(value);
  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  return addDays(value, daysUntilSunday);
}

function endOfCalendarMonth(value: string): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return isoFromDate(new Date(Date.UTC(year, month, 0)));
}

export function cashFlowPeriodBounds(
  filter: CashFlowFilter,
): readonly PeriodBounds[] {
  const parsed = cashFlowFilterSchema.parse(filter);
  const periods: PeriodBounds[] = [];
  let cursor = parsed.from;
  while (cursor <= parsed.to) {
    const calendarEnd =
      parsed.granularity === "weekly"
        ? endOfCalendarWeek(cursor)
        : endOfCalendarMonth(cursor);
    const endOn =
      /^\d{4}-\d{2}-\d{2}$/u.test(calendarEnd) && calendarEnd < parsed.to
        ? calendarEnd
        : parsed.to;
    periods.push({ endOn, startOn: cursor });
    if (endOn === parsed.to) break;
    cursor = addDays(endOn, 1);
  }
  return periods;
}

function actualTotals(
  lines: readonly CashFlowActualDailyAggregate[],
): CashFlowTotals & Readonly<{ entryCount: number }> {
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);
  let entryCount = 0;
  for (const line of lines) {
    inflow = inflow.plus(line.inflowAmount);
    outflow = outflow.plus(line.outflowAmount);
    entryCount += line.entryCount;
  }
  return {
    entryCount,
    inflowAmount: inflow.toFixed(4),
    netAmount: inflow.minus(outflow).toFixed(4),
    outflowAmount: outflow.toFixed(4),
  };
}

function accountOpeningTotal(
  lines: readonly CashFlowAccountOpeningDailyAggregate[],
): string {
  return lines
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
    .toFixed(4);
}

function forecastTotals(
  lines: readonly Pick<CashFlowForecastAggregate, "amount" | "direction">[],
): CashFlowTotals {
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);
  for (const line of lines) {
    if (line.direction === "inflow") inflow = inflow.plus(line.amount);
    else outflow = outflow.plus(line.amount);
  }
  return {
    inflowAmount: inflow.toFixed(4),
    netAmount: inflow.minus(outflow).toFixed(4),
    outflowAmount: outflow.toFixed(4),
  };
}

function inPeriod(eventOn: string | null, period: PeriodBounds): boolean {
  return eventOn !== null && eventOn >= period.startOn && eventOn <= period.endOn;
}

export function composeCashFlowReport(
  snapshot: CashFlowLedgerSnapshot,
  rawFilter: CashFlowFilter,
  generatedOn: string,
): CashFlowReport {
  const filter = cashFlowFilterSchema.parse(rawFilter);
  const scheduled = snapshot.forecast.filter((line) => line.bucket === "scheduled");
  const overdue = snapshot.forecast.filter((line) => line.bucket === "overdue");
  const overdueInRange = overdue.filter(
    (line) =>
      line.eventOn !== null &&
      line.eventOn >= filter.from &&
      line.eventOn <= filter.to,
  );
  const undatedInflowAmount = snapshot.forecast
    .filter((line) => line.bucket === "undated" && line.direction === "inflow")
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
    .toFixed(4);

  let runningBalance = new Decimal(snapshot.balance.openingBalanceAmount);
  const periods = cashFlowPeriodBounds(filter).map((period) => {
    const actual = actualTotals(
      snapshot.actual.filter((line) => inPeriod(line.eventOn, period)),
    );
    const accountOpeningAmount = accountOpeningTotal(
      snapshot.accountOpenings.filter((line) => inPeriod(line.eventOn, period)),
    );
    const openingBalanceAmount = runningBalance.toFixed(4);
    runningBalance = runningBalance.plus(accountOpeningAmount).plus(actual.netAmount);
    return {
      accountOpeningAmount,
      actual,
      closingBalanceAmount: runningBalance.toFixed(4),
      endOn: period.endOn,
      forecast: {
        overdue: forecastTotals(overdue.filter((line) => inPeriod(line.eventOn, period))),
        scheduled: forecastTotals(
          scheduled.filter((line) => inPeriod(line.eventOn, period)),
        ),
      },
      openingBalanceAmount,
      startOn: period.startOn,
    };
  });

  if (!runningBalance.equals(snapshot.balance.closingBalanceAmount)) {
    throw new FinanceLedgerIntegrityError();
  }

  return {
    actual: actualTotals(snapshot.actual),
    assumptions: [
      "Gerçekleşen gelir ve giderler, hesap hareketleri defterinden alınır; iç transferler brüt giriş veya çıkışı şişirmez.",
      "Dönem açılışı yalnız Europe/Istanbul iş gününe göre dönemden önce oluşturulmuş hesapların başlangıç bakiyelerini içerir; dönem içinde açılan hesapların başlangıç bakiyesi ayrı gösterilir ve kapanışta uzlaştırılır.",
      "Gerçekleşen hareketler Europe/Istanbul iş gününe göre bugünle sınırlandırılır; ileri tarihli açık kalemler tahmin olarak ayrı gösterilir.",
      "Gecikmiş toplam, seçilen aralıktan önce doğmuş olsa da bugün hâlâ açık olan tüm vadeli kalemleri içerir; dönem satırları yalnız kendi tarih aralığına düşen gecikmeleri gösterir.",
      "Hesap hareketine dönüştürülmeyen operasyon kayıtları gerçekleşen bakiyeye dahil edilmez.",
    ],
    balance: {
      accountOpeningAmount: accountOpeningTotal(snapshot.accountOpenings),
      accountCount: snapshot.balance.accountCount,
      asOfOn: filter.to < generatedOn ? filter.to : generatedOn,
      closingBalanceAmount: snapshot.balance.closingBalanceAmount,
      openingBalanceAmount: snapshot.balance.openingBalanceAmount,
      status: snapshot.balance.accountCount > 0 ? "configured" : "not_configured",
    },
    forecast: {
      lines: snapshot.forecast,
      overdue: forecastTotals(overdue),
      overdueInRange: forecastTotals(overdueInRange),
      scheduled: forecastTotals(scheduled),
      undatedInflowAmount,
    },
    generatedOn,
    granularity: filter.granularity,
    periods,
    range: { from: filter.from, to: filter.to },
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
  const filter = cashFlowFilterSchema.parse(rawFilter);
  const generatedOn = istanbulDate(now);
  return withUtcConsistentRead(pool, async (connection) =>
    composeCashFlowReport(
      await readCashFlowLedger(
        connection,
        { endOn: filter.to, startOn: filter.from },
        generatedOn,
      ),
      filter,
      generatedOn,
    ),
  );
}
