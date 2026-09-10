export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function dateFromIso(value: string): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new RangeError("Recurrence date must use YYYY-MM-DD.");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Recurrence date is invalid.");
  }
  return date;
}

function isoFromDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function recurrenceAnchorDay(value: string): number {
  return dateFromIso(value).getUTCDate();
}

export function nextOccurrenceOn(
  currentOn: string,
  frequency: RecurrenceFrequency,
  anchorDay: number,
): string {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError("Recurrence anchor day is invalid.");
  }
  const current = dateFromIso(currentOn);
  if (frequency === "daily" || frequency === "weekly") {
    current.setUTCDate(current.getUTCDate() + (frequency === "daily" ? 1 : 7));
    return isoFromDate(current);
  }
  if (frequency !== "monthly") {
    throw new RangeError("Recurrence frequency is invalid.");
  }

  const nextMonth = current.getUTCMonth() + 1;
  const nextYear = current.getUTCFullYear() + Math.floor(nextMonth / 12);
  const normalizedMonth = nextMonth % 12;
  return isoFromDate(
    new Date(
      Date.UTC(
        nextYear,
        normalizedMonth,
        Math.min(anchorDay, daysInMonth(nextYear, normalizedMonth)),
      ),
    ),
  );
}

export function occurrenceDatesInRange(input: Readonly<{
  anchorDay: number;
  endsOn: string | null;
  firstOn: string;
  frequency: RecurrenceFrequency;
  from: string;
  to: string;
}>): readonly string[] {
  dateFromIso(input.firstOn);
  dateFromIso(input.from);
  dateFromIso(input.to);
  if (input.from > input.to) throw new RangeError("Recurrence range is invalid.");
  if (input.endsOn !== null) dateFromIso(input.endsOn);

  const dates: string[] = [];
  let cursor = input.firstOn;
  for (let guard = 0; guard < 4000 && cursor <= input.to; guard += 1) {
    if (input.endsOn !== null && cursor > input.endsOn) break;
    if (cursor >= input.from) dates.push(cursor);
    cursor = nextOccurrenceOn(cursor, input.frequency, input.anchorDay);
  }
  return dates;
}
