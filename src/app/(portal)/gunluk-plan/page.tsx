import type { Metadata } from "next";

import { DailyPlanWorkspace } from "@/components/home/daily-plan-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Günlük plan · Portal Pusula",
};

export default function DailyPlanPage() {
  return (
    <PortalPermissionGate anyOf={["daily-plan.read"]}>
      <PortalPageHeader
        context="Günlük çalışma"
        note="Ziyaret, toplantı ve işleri gün içindeki gerçek sıraya yerleştirin."
        title="Günlük plan"
      />
      <DailyPlanWorkspace />
    </PortalPermissionGate>
  );
}
