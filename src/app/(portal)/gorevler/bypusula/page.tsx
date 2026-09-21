import type { Metadata } from "next";
import { BypusulaWorkspace } from "@/components/home/bypusula-workspace";
import { canTransfer } from "@/features/bypusula/access";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

export const metadata: Metadata = { title: "ByPusula aktarımı · Portal Pusula" };

export default async function BypusulaPage() {
  const principal = await authenticateCurrentPrincipal();
  if (!canTransfer(principal)) return <p role="alert">Bu alan için hesap oturumu, görev yazma, müşteri ve proje okuma izinleri gerekir.</p>;
  return <BypusulaWorkspace canCreateProject={hasPermission(principal, "projects.write")} canLinkCustomer={hasPermission(principal, "customers.write")} />;
}
