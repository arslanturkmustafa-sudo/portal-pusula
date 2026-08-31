import { describe, expect, it } from "vitest";

import { retryAt, retryDelayMs } from "./backoff";

describe("deterministic platform retry backoff", () => {
  const policy = { baseDelayMs: 1_000, maximumDelayMs: 8_000 } as const;

  it("grows exponentially and caps without jitter", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, policy))).toEqual(
      [1_000, 2_000, 4_000, 8_000, 8_000],
    );
  });

  it("derives the next instant only from the injected time and attempt", () => {
    expect(retryAt(new Date("2026-08-30T10:00:00.000Z"), 3, policy).toISOString()).toBe(
      "2026-08-30T10:00:04.000Z",
    );
  });
});
