import type { Metadata } from "next";

import { ExpensesPageWorkspace } from "@/components/home/expenses-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Giderler · Portal Pusula",
};

type ExpensesPageProps = Readonly<{
  searchParams: Promise<{ action?: string | string[] }>;
}>;

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const principal = await authenticateCurrentPrincipal();
  const { action } = await searchParams;
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["finance.expenses.read"]}>
      <ExpensesPageWorkspace
        initialCreate={action === "create"}
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
