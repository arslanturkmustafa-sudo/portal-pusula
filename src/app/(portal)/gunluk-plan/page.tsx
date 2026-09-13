import type { Metadata } from "next";

import { DailyPlanWorkspace } from "@/components/home/daily-plan-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Planlama · Portal Pusula",
};

export default async function DailyPlanPage() {
  const principal = await authenticateCurrentPrincipal();

  return (
    <PortalPermissionGate anyOf={["daily-plan.read"]}>
      <PortalPageHeader
        context="Takvim / saha"
        note="Ziyaretleri günlük, haftalık veya aylık inceleyin; gerçekleşenleri plandan tamamlayın."
        title="Planlama"
      />
      <DailyPlanWorkspace
        canWriteTasks={
          principal !== null && hasPermission(principal, "tasks.write")
        }
        canWriteVisits={
          principal !== null && hasPermission(principal, "visits.write")
        }
      />
    </PortalPermissionGate>
  );
}
