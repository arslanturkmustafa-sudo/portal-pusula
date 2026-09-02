import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/portal/module-placeholder";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export const metadata: Metadata = {
  title: "Projeler · Portal Pusula",
};

export default function ProjectsPage() {
  return (
    <>
      <PortalPageHeader
        context="Portföy görünümü"
        note="Mühendis Kafası, bypusula, optipusula ve 7 Emlak Ajansı çalışmalarını ayırın."
        title="Projeler"
      />
      <ModulePlaceholder
        description="Proje hedefleri, kilometre taşları, bütçe ve gerçekleşmeler bu alanda birlikte izlenecek."
        label="Proje çalışma alanı"
      />
    </>
  );
}
