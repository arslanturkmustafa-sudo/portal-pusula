import { scryptSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyAdminCredentials } from "@/platform/auth/password";

describe("administrator credentials", () => {
  it("requires both the canonical email and the scrypt password", async () => {
    const salt = Buffer.alloc(16, 7);
    const key = scryptSync("correct horse battery", salt, 64, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const environment = {
      ADMIN_EMAIL: "yonetici@example.com",
      ADMIN_PASSWORD_HASH: [
        "scrypt",
        "32768",
        "8",
        "1",
        salt.toString("base64url"),
        key.toString("base64url"),
      ].join("$"),
      SESSION_SECRET: "AbcdEFgh12345678",
    };

    await expect(
      verifyAdminCredentials(
        "YONETICI@example.com",
        "correct horse battery",
        environment,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyAdminCredentials(
        "other@example.com",
        "correct horse battery",
        environment,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyAdminCredentials("yonetici@example.com", "wrong", environment),
    ).resolves.toBe(false);
  });
});
