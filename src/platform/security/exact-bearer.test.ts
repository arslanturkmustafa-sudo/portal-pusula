import { describe, expect, it } from "vitest";

import { hasExactBearerAuthorization } from "@/platform/security/exact-bearer";

const token = "FakeTokenValue01";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/internal/readiness", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("exact Bearer authorization", () => {
  it("accepts only the exact configured Authorization value", () => {
    expect(hasExactBearerAuthorization(request(`Bearer ${token}`), token)).toBe(
      true,
    );
  });

  it.each([
    undefined,
    token,
    `bearer ${token}`,
    `Bearer  ${token}`,
    `Basic ${token}`,
    `Bearer ${"x".repeat(16)}`,
  ])("rejects a missing or non-exact header", (authorization) => {
    expect(hasExactBearerAuthorization(request(authorization), token)).toBe(
      false,
    );
  });
});
