import type { Metadata } from "next";

import { DailyPlanWorkspace } from "@/components/home/daily-plan-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export const metadata: Metadata = {
  title: "Günlük plan · Portal Pusula",
};

export default function DailyPlanPage() {
  return (
    <>
      <PortalPageHeader
        context="Günlük çalışma"
        note="Ziyaret, toplantı ve işleri gün içindeki gerçek sıraya yerleştirin."
        title="Günlük plan"
      />
      <DailyPlanWorkspace />
    </>
  );
}
