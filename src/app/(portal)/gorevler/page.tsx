import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/portal/module-placeholder";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export const metadata: Metadata = {
  title: "Görevler · Portal Pusula",
};

export default function TasksPage() {
  return (
    <>
      <PortalPageHeader
        context="İş takibi"
        note="Sorumlu, bağımlılık, süre ve tekrar bilgileriyle işleri yönetin."
        title="Görevler"
      />
      <ModulePlaceholder
        description="Kanban görevleri, sorumlu atama, bağımlılıklar ve zaman takibi burada yönetilecek."
        label="Görev çalışma alanı"
      />
    </>
  );
}
