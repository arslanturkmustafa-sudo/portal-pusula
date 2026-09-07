import type { Metadata } from "next";

import { PartnershipPageWorkspace } from "@/components/home/partnership-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Ortaklık hesabı · Portal Pusula",
};

export default async function PartnershipPage() {
  const principal = await authenticateCurrentPrincipal();
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["finance.partnership.read"]}>
      <PartnershipPageWorkspace
        capabilities={{
          canReadAudit: can("audit.read"),
          canReversePartnership: can("finance.partnership.reverse"),
        }}
      />
    </PortalPermissionGate>
  );
}
