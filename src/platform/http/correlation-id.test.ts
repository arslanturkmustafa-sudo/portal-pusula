import { describe, expect, it } from "vitest";

import {
  CORRELATION_ID_HEADER,
  correlationIdFromHeaders,
  isCorrelationId,
} from "@/platform/http/correlation-id";

describe("correlation IDs", () => {
  it("keeps a valid upstream correlation ID", () => {
    const id = crypto.randomUUID();
    const headers = new Headers({ [CORRELATION_ID_HEADER]: id });

    expect(correlationIdFromHeaders(headers)).toBe(id);
  });

  it("replaces hostile or malformed input", () => {
    const headers = new Headers({
      [CORRELATION_ID_HEADER]: "line-break-attempt-invalid",
    });
    const id = correlationIdFromHeaders(headers);

    expect(id).not.toBe("line-break-attempt-invalid");
    expect(isCorrelationId(id)).toBe(true);
  });
});

