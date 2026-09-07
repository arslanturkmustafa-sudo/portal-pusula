import type { Metadata } from "next";
import { Suspense } from "react";

import { TaskReportWorkspace } from "@/components/home/task-report-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Firma görev raporu · Portal Pusula",
};

export default function TaskReportPage() {
  return (
    <PortalPermissionGate anyOf={["tasks.reports.export"]}>
      <Suspense fallback={<p role="status">Rapor hazırlanıyor…</p>}>
        <TaskReportWorkspace />
      </Suspense>
    </PortalPermissionGate>
  );
}
