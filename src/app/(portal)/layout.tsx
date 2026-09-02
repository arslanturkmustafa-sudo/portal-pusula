import { redirect } from "next/navigation";

import { PortalShell } from "@/components/portal/portal-shell";
import { isCurrentAdminAuthenticated } from "@/platform/auth/server-auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await isCurrentAdminAuthenticated())) {
    redirect("/giris");
  }

  return <PortalShell>{children}</PortalShell>;
}
