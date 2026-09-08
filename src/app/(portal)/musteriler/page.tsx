import type { Metadata } from "next";

import { HomeScreen } from "@/components/home/home-screen";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = {
  title: "Müşteriler · Portal Pusula",
};

export default async function CustomersPage() {
  const principal = await authenticateCurrentPrincipal();
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  return (
    <PortalPermissionGate anyOf={["customers.read"]}>
      <HomeScreen
        capabilities={{
          canOpenCustomerDetails:
            can("customers.contact.read") &&
            can("contracts.billing.read") &&
            can("projects.read") &&
            can("visits.read"),
          canReadBilling: can("contracts.billing.read"),
          canReadProjects: can("projects.read"),
          canReadReceivables: can("finance.receivables.read"),
          canReadVisits: can("visits.read"),
          canReadAudit: can("audit.read"),
          canLifecycleContracts: can("contracts.lifecycle"),
          canLifecycleCustomers: can("customers.lifecycle"),
          canWriteCustomers:
            can("customers.write") && can("customers.contact.read"),
          canWriteTasks: can("tasks.write"),
          canWriteVisits: can("visits.write"),
        }}
        live
      />
    </PortalPermissionGate>
  );
}
