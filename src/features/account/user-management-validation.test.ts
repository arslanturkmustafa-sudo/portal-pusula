import { describe, expect, it } from "vitest";

import {
  createManagedUserInputSchema,
  updateManagedUserInputSchema,
} from "@/features/account/user-management-validation";

describe("managed user validation", () => {
  it("normalizes a member identity and accepts coherent module grants", () => {
    expect(
      createManagedUserInputSchema.parse({
        confirmation: "fake-safe-password-2026",
        displayName: "  Ayşe Yılmaz  ",
        email: "AYSE@EXAMPLE.COM",
        password: "fake-safe-password-2026",
        permissions: ["customers.read", "tasks.read", "tasks.reports.export"],
      }),
    ).toMatchObject({ displayName: "Ayşe Yılmaz", email: "ayse@example.com" });
  });

  it("rejects account management grants, duplicate permissions and writes without read", () => {
    expect(() =>
      updateManagedUserInputSchema.parse({
        permissions: ["accounts.manage"],
        status: "active",
      }),
    ).toThrow();
    expect(() =>
      updateManagedUserInputSchema.parse({
        permissions: ["tasks.read", "tasks.read"],
        status: "active",
      }),
    ).toThrow();
    expect(() =>
      updateManagedUserInputSchema.parse({
        permissions: ["finance.expenses.write"],
        status: "active",
      }),
    ).toThrow();
    expect(() =>
      updateManagedUserInputSchema.parse({
        permissions: ["finance.receivables.reverse"],
        status: "active",
      }),
    ).toThrow();
  });

  it("accepts coherent lifecycle and reversal permissions", () => {
    expect(
      updateManagedUserInputSchema.parse({
        permissions: [
          "customers.read",
          "customers.contact.read",
          "projects.read",
          "customers.write",
          "customers.lifecycle",
          "finance.receivables.read",
          "finance.receivables.write",
          "finance.receivables.reverse",
          "audit.read",
        ],
        status: "active",
      }).permissions,
    ).toContain("customers.lifecycle");
  });
});
