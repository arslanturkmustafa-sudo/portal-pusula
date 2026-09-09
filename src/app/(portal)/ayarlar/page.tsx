import type { Metadata } from "next";

import { NotificationSettingsWorkspace } from "@/components/home/notification-settings-workspace";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";

export const metadata: Metadata = {
  title: "Ayarlar · Portal Pusula",
};

export default function SettingsPage() {
  return (
    <PortalPermissionGate anyOf={["accounts.manage"]}>
      <NotificationSettingsWorkspace />
    </PortalPermissionGate>
  );
}
