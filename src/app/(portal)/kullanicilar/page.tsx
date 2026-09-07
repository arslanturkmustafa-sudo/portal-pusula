import type { Metadata } from "next";

import { UsersWorkspace } from "@/components/home/users-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Kullanıcılar · Portal Pusula",
};

export default function UsersPage() {
  return (
    <PortalPermissionGate anyOf={["accounts.manage"]}>
      <UsersWorkspace />
    </PortalPermissionGate>
  );
}
