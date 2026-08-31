export const CORRELATION_ID_HEADER = "x-correlation-id";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

export function isCorrelationId(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value);
}

export function correlationIdFromHeaders(headers: Headers): string {
  const candidate = headers.get(CORRELATION_ID_HEADER);
  return isCorrelationId(candidate) ? candidate : createCorrelationId();
}

