import type { Metadata } from "next";

import { FinancePageWorkspace } from "@/components/home/finance-page-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Finans · Portal Pusula",
};

export default async function FinancePage() {
  const principal = await authenticateCurrentPrincipal();
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["finance.receivables.read"]}>
      <PortalPageHeader
        context="Finans masası"
        note="Aylık hakedişleri, geçmiş alacakları ve tahsilatları takip edin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <FinancePageWorkspace
        capabilities={{
          canReadAudit: can("audit.read"),
          canReadAccounts: can("finance.accounts.read"),
          canReverseReceivables: can("finance.receivables.reverse"),
          canWriteAccounts: can("finance.accounts.write"),
          canWriteReceivables: can("finance.receivables.write"),
        }}
      />
    </PortalPermissionGate>
  );
}
