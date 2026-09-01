import { describe, expect, it } from "vitest";

import {
  AuthEnvironmentError,
  parseAuthEnvironment,
} from "@/platform/config/auth-env.schema";

const validHash =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("auth environment", () => {
  it("normalizes the administrator email and accepts a 16 character session key", () => {
    expect(
      parseAuthEnvironment({
        ADMIN_EMAIL: "  YONETICI@Example.com ",
        ADMIN_PASSWORD_HASH: validHash,
        SESSION_SECRET: "AbcdEFgh12345678",
      }),
    ).toEqual({
      ADMIN_EMAIL: "yonetici@example.com",
      ADMIN_PASSWORD_HASH: validHash,
      SESSION_SECRET: "AbcdEFgh12345678",
    });
  });

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
