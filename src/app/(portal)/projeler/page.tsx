import type { Metadata } from "next";

import { ProjectsWorkspace } from "@/components/home/projects-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Projeler · Portal Pusula",
};

export default async function ProjectsPage() {
  const principal = await authenticateCurrentPrincipal();
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["projects.read"]}>
      <ProjectsWorkspace
        capabilities={{
          canLifecycleProjects: can("projects.lifecycle"),
          canReadAudit: can("audit.read"),
        }}
      />
    </PortalPermissionGate>
  );
}
