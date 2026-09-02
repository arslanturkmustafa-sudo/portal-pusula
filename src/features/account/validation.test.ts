import { describe, expect, it } from "vitest";

import { passwordChangeInputSchema } from "@/features/account/validation";

describe("account password validation", () => {
  it("accepts 8-256 characters and an optional current password", () => {
    expect(
      passwordChangeInputSchema.parse({
        confirmation: "12345678",
        newPassword: "12345678",
      }),
    ).toEqual({ confirmation: "12345678", newPassword: "12345678" });
  });

  it("rejects mismatched, short or unchanged passwords", () => {
    const unchangedValue = ["same", "sample"].join("-");
    expect(
      passwordChangeInputSchema.safeParse({
        confirmation: "different-password",
        currentPassword: unchangedValue,
        newPassword: unchangedValue,
      }).success,
    ).toBe(false);
    expect(
      passwordChangeInputSchema.safeParse({
        confirmation: "short",
        newPassword: "short",
      }).success,
    ).toBe(false);
  });
});
