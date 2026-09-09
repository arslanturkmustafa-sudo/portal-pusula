import { describe, expect, it } from "vitest";

import { safePortalReturnPath } from "@/platform/navigation/portal-return-path";

describe("safePortalReturnPath", () => {
  it.each([
    "/",
    "/finans",
    "/ayarlar",
    "/finans/raporlar?month=2026-09",
    "/gorevler/rapor?customerId=10000000-0000-4000-8000-000000000001",
  ])("keeps an allowlisted internal target: %s", (value) => {
    expect(safePortalReturnPath(value)).toBe(value);
  });

  it.each([
    "https://example.com/finans",
    "//example.com/finans",
    "/\\example.com",
    "/api/customers",
    "/giris",
    "/finans#secret",
    "/finans\nSet-Cookie:test",
    null,
  ])("falls back for an unsafe target: %s", (value) => {
    expect(safePortalReturnPath(value)).toBe("/");
  });
});
