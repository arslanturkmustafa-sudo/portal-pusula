import { addMilliseconds } from "./time";

export type BackoffPolicy = Readonly<{
  baseDelayMs: number;
  maximumDelayMs: number;
}>;

export const defaultBackoffPolicy: BackoffPolicy = Object.freeze({
  baseDelayMs: 1_000,
  maximumDelayMs: 60_000,
});

export function retryDelayMs(
  attemptNo: number,
  policy: BackoffPolicy = defaultBackoffPolicy,
): number {
  if (
    !Number.isSafeInteger(attemptNo) ||
    attemptNo < 1 ||
    !Number.isSafeInteger(policy.baseDelayMs) ||
    policy.baseDelayMs < 1 ||
    !Number.isSafeInteger(policy.maximumDelayMs) ||
    policy.maximumDelayMs < policy.baseDelayMs
  ) {
    throw new Error("Invalid retry policy.");
  }

  const exponent = Math.min(attemptNo - 1, 30);
  return Math.min(
    policy.maximumDelayMs,
    policy.baseDelayMs * 2 ** exponent,
  );
}

export function retryAt(
  now: Date,
  attemptNo: number,
  policy: BackoffPolicy = defaultBackoffPolicy,
): Date {
  return addMilliseconds(now, retryDelayMs(attemptNo, policy));
}
