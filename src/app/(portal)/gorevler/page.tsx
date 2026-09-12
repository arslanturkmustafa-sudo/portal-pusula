import type { Metadata } from "next";

import { TasksWorkspace } from "@/components/home/tasks-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Görevler · Portal Pusula",
};

type TasksPageProps = Readonly<{
  searchParams: Promise<{ action?: string | string[] }>;
}>;

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const principal = await authenticateCurrentPrincipal();
  const { action } = await searchParams;
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["tasks.read"]}>
      <TasksWorkspace
        initialCreate={action === "create"}
        key={action === "create" ? "quick-create" : "workspace"}
        capabilities={{
          canExportReports: can("tasks.reports.export"),
          canLifecycleTasks: can("tasks.lifecycle"),
          canReadAudit: can("audit.read"),
          canReadCustomers: can("customers.read"),
          canReadProjects: can("projects.read"),
          canWriteTasks:
            can("tasks.write") &&
            can("customers.read") &&
            can("projects.read"),
        }}
      />
    </PortalPermissionGate>
  );
}
