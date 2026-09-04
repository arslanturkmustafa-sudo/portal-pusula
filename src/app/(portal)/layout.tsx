import { redirect } from "next/navigation";

import { PortalShell } from "@/components/portal/portal-shell";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const principal = await authenticateCurrentPrincipal();
  if (!principal) {
    redirect("/giris");
  }

  return <PortalShell principal={principal}>{children}</PortalShell>;
}
