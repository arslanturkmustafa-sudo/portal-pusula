import { describe, expect, it } from "vitest";

import {
  AuthEnvironmentError,
  parseAuthEnvironment,
} from "@/platform/config/auth-env.schema";

const currentHash =
  "scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const legacyHash =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("auth environment", () => {
  it.each([currentHash, legacyHash])(
    "normalizes the administrator email and accepts a supported password hash",
    (passwordHash) => {
      expect(
        parseAuthEnvironment({
          ADMIN_EMAIL: "  YONETICI@Example.com ",
          ADMIN_PASSWORD_HASH: passwordHash,
          SESSION_SECRET: "AbcdEFgh12345678",
        }),
      ).toEqual({
        ADMIN_EMAIL: "yonetici@example.com",
        ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: "AbcdEFgh12345678",
      });
    },
  );

  it("fails closed for malformed authentication values", () => {
    expect(() =>
      parseAuthEnvironment({
        ADMIN_EMAIL: "not-an-email",
        ADMIN_PASSWORD_HASH: "plain-text",
        SESSION_SECRET: "too-short",
      }),
    ).toThrow(AuthEnvironmentError);
  });
});
