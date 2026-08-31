export type Clock = {
  now: () => Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

export function toUtcDateTime6(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Invalid UTC instant.");
  }

  return value.toISOString().replace("T", " ").replace("Z", "000");
}

export function addMilliseconds(value: Date, milliseconds: number): Date {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Invalid time interval.");
  }

  return new Date(value.getTime() + milliseconds);
}
