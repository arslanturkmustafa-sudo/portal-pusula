import type { Metadata } from "next";

import { ExpensesPageWorkspace } from "@/components/home/expenses-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Giderler · Portal Pusula",
};

export default async function ExpensesPage() {
  const principal = await authenticateCurrentPrincipal();
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["finance.expenses.read"]}>
      <ExpensesPageWorkspace
        capabilities={{
          canReadAudit: can("audit.read"),
          canReadAccounts: can("finance.accounts.read"),
          canReverseExpenses: can("finance.expenses.reverse"),
          canWriteAccounts: can("finance.accounts.write"),
          canWriteExpenses: can("finance.expenses.write"),
        }}
      />
    </PortalPermissionGate>
  );
}
