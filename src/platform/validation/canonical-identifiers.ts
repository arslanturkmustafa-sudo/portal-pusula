const CANONICAL_ASCII_KEY_PATTERN = /^[\x21-\x7e]+$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const MAX_ATTEMPTS_UPPER_BOUND = 65_535;

export class PlatformInputError extends Error {
  constructor(kind: "key" | "max_attempts" | "uuid") {
    super(`Platform ${kind} input is invalid.`);
    this.name = "PlatformInputError";
  }
}

export function assertCanonicalAsciiKey(
  value: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    !Number.isSafeInteger(maximumLength) ||
    maximumLength < 1 ||
    value.length < 1 ||
    value.length > maximumLength ||
    !CANONICAL_ASCII_KEY_PATTERN.test(value)
  ) {
    throw new PlatformInputError("key");
  }

  return value;
}

export function assertCanonicalUuid(value: string): string {
  if (
    typeof value !== "string" ||
    !CANONICAL_UUID_PATTERN.test(value)
  ) {
    throw new PlatformInputError("uuid");
  }

  return value;
}

export function assertMaxAttempts(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_ATTEMPTS_UPPER_BOUND
  ) {
    throw new PlatformInputError("max_attempts");
  }

  return value;
}
