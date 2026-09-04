import type { Metadata } from "next";

import { CardPlanPageWorkspace } from "@/components/home/card-plan-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Kartlar ve ödeme planı · Portal Pusula",
};

export default function CardsPage() {
  return (
    <PortalPermissionGate anyOf={["finance.cards.read"]}>
      <CardPlanPageWorkspace />
    </PortalPermissionGate>
  );
}
