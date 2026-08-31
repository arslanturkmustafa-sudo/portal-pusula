import { describe, expect, it } from "vitest";

import {
  assertCanonicalAsciiKey,
  assertCanonicalUuid,
  assertMaxAttempts,
  MAX_ATTEMPTS_UPPER_BOUND,
  PlatformInputError,
} from "@/platform/validation/canonical-identifiers";

describe("canonical platform identifiers", () => {
  it("accepts bounded printable ASCII keys", () => {
    expect(assertCanonicalAsciiKey("platform.job:v1_window-01", 64)).toBe(
      "platform.job:v1_window-01",
    );
  });

  it.each([
    "",
    " leading",
    "trailing ",
    "internal space",
    "tab\tkey",
    "line\nkey",
    "ünicode",
  ])("rejects non-canonical key %j", (value) => {
    expect(() => assertCanonicalAsciiKey(value, 64)).toThrow(
      PlatformInputError,
    );
  });

  it("rejects keys beyond their persisted length", () => {
    expect(() => assertCanonicalAsciiKey("a".repeat(65), 64)).toThrow(
      PlatformInputError,
    );
  });

  it("accepts canonical lowercase UUIDs", () => {
    expect(
      assertCanonicalUuid("018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe17"),
    ).toBe("018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe17");
  });

  it.each([
    "018F1F6E-7B2A-7CC1-8D43-2DB5D3A2FE17",
    "018f1f6e-7b2a-7cc1-8d43-2db5d3a2fe17 ",
    "018f1f6e-7b2a-0cc1-8d43-2db5d3a2fe17",
    "not-a-uuid",
  ])("rejects non-canonical UUID %j", (value) => {
    expect(() => assertCanonicalUuid(value)).toThrow(PlatformInputError);
  });

  it.each([1, MAX_ATTEMPTS_UPPER_BOUND])(
    "accepts maxAttempts boundary %d",
    (value) => {
      expect(assertMaxAttempts(value)).toBe(value);
    },
  );

  it.each([0, -1, 1.5, MAX_ATTEMPTS_UPPER_BOUND + 1, Number.NaN])(
    "rejects invalid maxAttempts %s",
    (value) => {
      expect(() => assertMaxAttempts(value)).toThrow(PlatformInputError);
    },
  );
});
