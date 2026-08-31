import { describe, expect, it } from "vitest";

import {
  parseDatabaseProbeEnvironment,
  parseReadinessBearerToken,
  ReadinessEnvironmentError,
} from "@/platform/config/readiness-env.schema";

const validDatabaseInput = {
  DB_NAME: "portal_probe",
  DB_USER: "portal_probe_user",
  DB_PASSWORD: "not-a-real-password",
};

describe("readiness environment", () => {
  it("uses only the documented local Hostinger defaults", () => {
    expect(parseDatabaseProbeEnvironment(validDatabaseInput)).toEqual({
      DB_HOST: "localhost",
      DB_PORT: 3306,
      ...validDatabaseInput,
    });
  });

  it("accepts an explicit host and numeric port", () => {
    expect(
      parseDatabaseProbeEnvironment({
        ...validDatabaseInput,
        DB_HOST: "127.0.0.1",
        DB_PORT: "3307",
      }),
    ).toMatchObject({ DB_HOST: "127.0.0.1", DB_PORT: 3307 });
  });

  it.each(["DB_NAME", "DB_USER", "DB_PASSWORD"] as const)(
    "fails closed when %s is missing",
    (name) => {
      const input = { ...validDatabaseInput } as Record<
        string,
        string | undefined
      >;
      delete input[name];

      expect(() => parseDatabaseProbeEnvironment(input)).toThrow(
        ReadinessEnvironmentError,
      );
    },
  );

  it("rejects an invalid port without echoing environment values", () => {
    const passwordSentinel = "database-password-sentinel";

    try {
      parseDatabaseProbeEnvironment({
        ...validDatabaseInput,
        DB_PASSWORD: passwordSentinel,
        DB_PORT: "invalid-port-sentinel",
      });
      throw new Error("Expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessEnvironmentError);
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(passwordSentinel);
      expect(serialized).not.toContain("invalid-port-sentinel");
    }
  });

  it("accepts exactly 16 ASCII alphanumeric readiness characters", () => {
    const token = "FakeTokenValue01";

    expect(parseReadinessBearerToken(token)).toBe(token);
  });

  it.each([
    ["missing", undefined],
    ["15 characters", "A".repeat(15)],
    ["17 characters", "A".repeat(17)],
    ["whitespace", `${"A".repeat(8)} ${"B".repeat(7)}`],
    ["trailing newline", `${"A".repeat(16)}\n`],
    ["Turkish character", `${"A".repeat(15)}Ş`],
    ["symbol", `${"A".repeat(15)}!`],
  ])("fails closed for %s", (_case, value) => {
    try {
      parseReadinessBearerToken(value);
      throw new Error("Expected token parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessEnvironmentError);
      expect(JSON.stringify(error)).not.toContain(value ?? "undefined");
    }
  });
});
