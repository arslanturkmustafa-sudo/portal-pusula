import type { Metadata } from "next";

import { MyDayWorkspace } from "@/components/home/my-day-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { PortalPermissionGate } from "@/components/portal/portal-permission-gate";
import { istanbulDate } from "@/features/finance/period";
import { getTodayOverview, type TodayOverview } from "@/features/today";
import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Günüm · Portal Pusula",
};

const MY_DAY_PERMISSIONS = [
  "daily-plan.read",
  "tasks.read",
  "finance.reports.read",
] as const satisfies readonly PermissionCode[];

export default async function MyDayPage() {
  const principal = await authenticateCurrentPrincipal();
  const can = (permission: PermissionCode) =>
    principal ? hasPermission(principal, permission) : false;
  const canReadPlanning = can("daily-plan.read");
  const canReadVisits = canReadPlanning && can("visits.read");
  const canReadTasks = can("tasks.read");
  const canReadFinance = can("finance.reports.read");
  const businessDate = istanbulDate(new Date());
  let overview: TodayOverview | null = null;

  if (principal && MY_DAY_PERMISSIONS.some((permission) => can(permission))) {
    try {
      overview = await getTodayOverview(
        getPlatformDatabasePool(getDatabaseProbeEnvironment()),
        businessDate,
        {
          canReadFinance,
          canReadTasks,
          canReadVisits,
        },
      );
    } catch {
      overview = null;
    }
  }

  return (
    <PortalPermissionGate anyOf={MY_DAY_PERMISSIONS}>
      <PortalPageHeader
        context="Bugün / operasyon"
        note="Sabah özetindeki ziyaretleri, görevleri ve vadesi gelen finans hareketlerini tek ekrandan takip edin."
        title="Günüm"
      />
      <MyDayWorkspace
        capabilities={{
          canCreateExpenses:
            can("finance.expenses.read") && can("finance.expenses.write"),
          canCreateTasks:
            can("tasks.write") && can("customers.read") && can("projects.read"),
          canReadFinance,
          canReadPlanning,
          canReadTasks,
          canReadVisits,
        }}
        overview={overview}
      />
    </PortalPermissionGate>
  );
}
