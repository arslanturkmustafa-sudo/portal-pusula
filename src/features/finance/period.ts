export function monthBounds(month: string): Readonly<{
  monthStart: string;
  nextMonthStart: string;
}> {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    monthStart: monthStart.toISOString().slice(0, 10),
    nextMonthStart: nextMonth.toISOString().slice(0, 10),
  };
}

export function dueDateForMonth(month: string, paymentDay: number): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(paymentDay, lastDay)).padStart(2, "0")}`;
}

export function monthIntersectsPeriod(
  month: string,
  startsOn: string,
  endsOn: string,
): boolean {
  const { monthStart, nextMonthStart } = monthBounds(month);
  return monthStart <= endsOn && nextMonthStart > startsOn;
}

export function istanbulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
