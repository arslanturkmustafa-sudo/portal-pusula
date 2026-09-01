import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "@/platform/auth/session";

describe("admin session token", () => {
  it("accepts an intact token and rejects tampering or expiry", () => {
    const secret = "AbcdEFgh12345678";
    const now = Date.UTC(2026, 8, 1, 9, 0, 0);
    const token = createSessionToken(secret, now);

    expect(verifySessionToken(token, secret, now + 1_000)).toBe(true);
    expect(verifySessionToken(token + "x", secret, now + 1_000)).toBe(false);
    expect(verifySessionToken(token, "ZbcdEFgh12345678", now + 1_000)).toBe(false);
    expect(
      verifySessionToken(token, secret, now + (SESSION_TTL_SECONDS + 1) * 1_000),
    ).toBe(false);
  });
});
