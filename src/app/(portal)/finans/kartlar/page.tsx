import type { Metadata } from "next";

import { CardPlanPageWorkspace } from "@/components/home/card-plan-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Kartlar ve ödeme planı · Portal Pusula",
};

export default async function CardsPage() {
  const principal = await authenticateCurrentPrincipal();
  return (
    <PortalPermissionGate anyOf={["finance.cards.read"]}>
      <CardPlanPageWorkspace
        canWrite={
          principal ? hasPermission(principal, "finance.cards.write") : false
        }
      />
    </PortalPermissionGate>
  );
}
