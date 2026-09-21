import { projectScope } from "@/platform/auth/project-access";
import { hasPermission } from "@/platform/auth/permissions";
import type { AuthenticatedPrincipal } from "@/platform/auth/server-auth";

export function canTransfer(principal: AuthenticatedPrincipal | null): principal is Extract<AuthenticatedPrincipal, { kind: "account" }> {
  return principal?.kind === "account" && projectScope(principal) === null &&
    (["tasks.read", "tasks.write", "customers.read", "projects.read"] as const).every((permission) => hasPermission(principal, permission));
}
