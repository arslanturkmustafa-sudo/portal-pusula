import { describe, expect, it } from "vitest";

import {
  hasPermission,
  isPermissionCode,
  PermissionDeniedError,
  requirePermission,
} from "@/platform/auth/permissions";

describe("module permissions", () => {
  it("gives owners every known permission without persisted grants", () => {
    expect(hasPermission({ permissions: [], role: "owner" }, "finance.reports.read")).toBe(true);
  });

  it("gives members only their exact persisted grants", () => {
    const principal = { permissions: ["tasks.read"] as const, role: "member" as const };
    expect(hasPermission(principal, "tasks.read")).toBe(true);
    expect(hasPermission(principal, "finance.receivables.read")).toBe(false);
    expect(() => requirePermission(principal, "finance.receivables.read")).toThrow(
      PermissionDeniedError,
    );
  });

  it("rejects unknown or case-shifted permission codes", () => {
    expect(isPermissionCode("tasks.read")).toBe(true);
    expect(isPermissionCode("TASKS.READ")).toBe(false);
    expect(isPermissionCode("finance.secret.read")).toBe(false);
  });

  it("recognizes lifecycle, reversal and audit permissions", () => {
    expect(isPermissionCode("customers.lifecycle")).toBe(true);
    expect(isPermissionCode("finance.receivables.reverse")).toBe(true);
    expect(isPermissionCode("audit.read")).toBe(true);
    expect(isPermissionCode("finance.accounts.read")).toBe(true);
    expect(isPermissionCode("finance.accounts.write")).toBe(true);
  });

  it("does not infer sensitive finance-account access for a member", () => {
    const principal = {
      permissions: ["finance.expenses.read"] as const,
      role: "member" as const,
    };
    expect(hasPermission(principal, "finance.accounts.read")).toBe(false);
    expect(hasPermission(principal, "finance.accounts.write")).toBe(false);
  });
});
