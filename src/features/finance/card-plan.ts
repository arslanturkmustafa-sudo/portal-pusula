import Decimal from "decimal.js";

export type PlannedCardInstallment = Readonly<{
  amount: string;
  dueOn: string;
  installmentCount: number;
  installmentNumber: number;
  statementMonth: string;
}>;

function monthParts(month: string): readonly [number, number] {
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}

function addMonths(month: string, offset: number): string {
  const [year, monthNumber] = monthParts(month);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [year, monthNumber] = monthParts(month);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function dateInMonth(month: string, requestedDay: number): string {
  const day = Math.min(requestedDay, daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function statementMonthForPurchase(
  incurredOn: string,
  statementClosingDay: number,
): string {
  const purchaseMonth = incurredOn.slice(0, 7);
  const purchaseDay = Number(incurredOn.slice(8, 10));
  const effectiveClosingDay = Math.min(
    statementClosingDay,
    daysInMonth(purchaseMonth),
  );
  return purchaseDay <= effectiveClosingDay
    ? purchaseMonth
    : addMonths(purchaseMonth, 1);
}

export function dueDateForStatement(
  statementMonth: string,
  statementClosingDay: number,
  paymentDueDay: number,
): string {
  const effectiveClosingDay = Math.min(
    statementClosingDay,
    daysInMonth(statementMonth),
  );
  const dueMonth =
    paymentDueDay > effectiveClosingDay
      ? statementMonth
      : addMonths(statementMonth, 1);
  return dateInMonth(dueMonth, paymentDueDay);
}

export function buildCardInstallmentPlan(input: Readonly<{
  incurredOn: string;
  installmentCount: number;
  paymentDueDay: number;
  statementClosingDay: number;
  totalAmount: string;
}>): readonly PlannedCardInstallment[] {
  const total = new Decimal(input.totalAmount);
  const baseAmount = total
    .dividedBy(input.installmentCount)
    .toDecimalPlaces(4, Decimal.ROUND_DOWN);
  if (baseAmount.lessThanOrEqualTo(0)) {
    throw new RangeError("Installment amount must be positive.");
  }
  const firstStatementMonth = statementMonthForPurchase(
    input.incurredOn,
    input.statementClosingDay,
  );

  return Array.from({ length: input.installmentCount }, (_, index) => {
    const statementMonth = addMonths(firstStatementMonth, index);
    const amount =
      index === input.installmentCount - 1
        ? total.minus(baseAmount.times(input.installmentCount - 1))
        : baseAmount;
    return {
      amount: amount.toFixed(4),
      dueOn: dueDateForStatement(
        statementMonth,
        input.statementClosingDay,
        input.paymentDueDay,
      ),
      installmentCount: input.installmentCount,
      installmentNumber: index + 1,
      statementMonth,
    };
  });
}
