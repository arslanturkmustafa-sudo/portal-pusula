// @vitest-environment node

import { describe, expect, it } from "vitest";

// @ts-expect-error The interactive generator is intentionally plain Node ESM.
import { encodePasswordHash } from "../../../scripts/generate-admin-auth.mjs";
import { verifyPassword } from "@/platform/auth/password";
import { parseAuthEnvironment } from "@/platform/config/auth-env.schema";

describe("administrator auth generator", () => {
  it("emits a Hostinger-safe colon-delimited hash accepted by runtime auth", async () => {
    const password = ["correct", "horse", "battery"].join(" ");
    const passwordHash = await encodePasswordHash(
      password,
      Buffer.alloc(16, 13),
    );

    expect(passwordHash).toMatch(
      /^scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$/u,
    );
    expect(passwordHash).not.toContain("$");
    expect(
      parseAuthEnvironment({
        ADMIN_EMAIL: "yonetici@example.com",
        ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: "AbcdEFgh12345678",
      }).ADMIN_PASSWORD_HASH,
    ).toBe(passwordHash);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
  });
});
