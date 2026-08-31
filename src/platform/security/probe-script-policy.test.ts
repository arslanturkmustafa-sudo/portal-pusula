// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("secure readiness probe script", () => {
  const source = readFileSync(
    resolve("scripts/probe-readiness-secure.ps1"),
    "utf8",
  );

  it("validates exactly 16 ASCII alphanumeric characters before the request", () => {
    const validationPosition = source.indexOf("[A-Za-z0-9]{16}");
    const requestPosition = source.indexOf("[System.Net.HttpWebRequest]::Create");

    expect(source).toContain("exactly 16 ASCII alphanumeric characters");
    expect(validationPosition).toBeGreaterThan(-1);
    expect(requestPosition).toBeGreaterThan(validationPosition);
    expect(source).toContain("RegexOptions]::CultureInvariant");
  });

  it("keeps the token hidden and avoids regex match state", () => {
    expect(source).toContain("-AsSecureString");
    expect(source).toContain("ZeroFreeBSTR");
    expect(source).not.toMatch(/Write-(?:Host|Output).*plainToken/iu);
    expect(source).not.toMatch(/-(?:c)?(?:not)?match\b/iu);
  });
});
