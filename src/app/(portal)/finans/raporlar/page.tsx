import type { Metadata } from "next";

import { ProjectFinancePageWorkspace } from "@/components/home/project-finance-page-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Proje görünümü · Portal Pusula",
};

export default function ProjectFinanceReportPage() {
  return (
    <PortalPermissionGate anyOf={["finance.reports.read"]}>
      <ProjectFinancePageWorkspace />
    </PortalPermissionGate>
  );
}
