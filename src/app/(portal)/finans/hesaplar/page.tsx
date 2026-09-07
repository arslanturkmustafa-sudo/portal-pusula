import type { Metadata } from "next";

import { FinanceAccountsPageWorkspace } from "@/components/home/finance-accounts-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Kasa ve bankalar · Portal Pusula",
};

export default async function FinanceAccountsPage() {
  const principal = await authenticateCurrentPrincipal();
  return (
    <PortalPermissionGate anyOf={["finance.accounts.read"]}>
      <FinanceAccountsPageWorkspace
        canWrite={
          principal ? hasPermission(principal, "finance.accounts.write") : false
        }
      />
    </PortalPermissionGate>
  );
}
