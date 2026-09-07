import type { Metadata } from "next";

import { CashFlowPageWorkspace } from "@/components/home/cash-flow-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Nakit akışı · Portal Pusula",
};

export default function CashFlowPage() {
  return (
    <PortalPermissionGate anyOf={["finance.reports.read"]}>
      <CashFlowPageWorkspace />
    </PortalPermissionGate>
  );
}
