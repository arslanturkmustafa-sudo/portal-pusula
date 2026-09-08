import type { Metadata } from "next";

import { TaxPageWorkspace } from "@/components/home/tax-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Vergiler · Portal Pusula",
};

export default async function TaxesPage() {
  const principal = await authenticateCurrentPrincipal();
  return (
    <PortalPermissionGate anyOf={["finance.taxes.read"]}>
      <TaxPageWorkspace
        canWrite={
          principal ? hasPermission(principal, "finance.taxes.write") : false
        }
      />
    </PortalPermissionGate>
  );
}
