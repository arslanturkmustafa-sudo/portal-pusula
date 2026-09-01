import Decimal from "decimal.js";

import type { VatMode } from "@/features/contracts/repository";

const MAX_MONEY = new Decimal("999999999999999.9999");

export type MoneySnapshot = Readonly<{
  netAmount: string;
  totalAmount: string;
  vatAmount: string;
}>;

export type ReceivableStatus = "open" | "overdue" | "paid" | "partial";

function fixed4(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function ensureFits(...values: readonly string[]): void {
  if (values.some((value) => new Decimal(value).greaterThan(MAX_MONEY))) {
    throw new RangeError("Money value exceeds DECIMAL(19,4).");
  }
}

export function contractMoneySnapshot(
  monthlyFeeAmount: string,
  vatMode: VatMode,
  vatRate: string,
): MoneySnapshot {
  const fee = new Decimal(monthlyFeeAmount);
  const rate = new Decimal(vatRate).dividedBy(100);
  let netAmount: string;
  let vatAmount: string;
  let totalAmount: string;

  if (vatMode === "exempt") {
    netAmount = fixed4(fee);
    vatAmount = "0.0000";
    totalAmount = netAmount;
  } else if (vatMode === "exclusive") {
    netAmount = fixed4(fee);
    vatAmount = fixed4(fee.times(rate));
    totalAmount = fixed4(new Decimal(netAmount).plus(vatAmount));
  } else {
    totalAmount = fixed4(fee);
    netAmount = fixed4(fee.dividedBy(rate.plus(1)));
    vatAmount = fixed4(new Decimal(totalAmount).minus(netAmount));
  }

  ensureFits(netAmount, vatAmount, totalAmount);
  return { netAmount, totalAmount, vatAmount };
}

export function proratedContractFee(
  monthlyFeeAmount: string,
  month: string,
  startsOn: string,
  endsOn: string,
): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const activeStart = startsOn > monthStart ? startsOn : monthStart;
  const activeEnd = endsOn < monthEnd ? endsOn : monthEnd;
  const activeDays =
    Math.floor(
      (Date.parse(`${activeEnd}T00:00:00Z`) -
        Date.parse(`${activeStart}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  if (activeDays <= 0) throw new RangeError("Month is outside contract period.");
  return fixed4(
    new Decimal(monthlyFeeAmount)
      .times(activeDays)
      .dividedBy(daysInMonth),
  );
}

export function openingBalanceMoneySnapshot(
  netAmount: string,
  vatAmount: string,
): MoneySnapshot {
  const normalizedNet = fixed4(netAmount);
  const normalizedVat = fixed4(vatAmount);
  const totalAmount = fixed4(
    new Decimal(normalizedNet).plus(normalizedVat),
  );
  ensureFits(normalizedNet, normalizedVat, totalAmount);
  return {
    netAmount: normalizedNet,
    totalAmount,
    vatAmount: normalizedVat,
  };
}

export function remainingAmount(
  totalAmount: string,
  collectedAmount: string,
): string {
  return fixed4(new Decimal(totalAmount).minus(collectedAmount));
}

export function receivableStatus(
  totalAmount: string,
  collectedAmount: string,
  dueOn: string,
  today: string,
): ReceivableStatus {
  const total = new Decimal(totalAmount);
  const collected = new Decimal(collectedAmount);
  if (collected.greaterThanOrEqualTo(total)) return "paid";
  if (dueOn < today) return "overdue";
  if (collected.greaterThan(0)) return "partial";
  return "open";
}

export function addMoney(left: string, right: string): string {
  return fixed4(new Decimal(left).plus(right));
}
