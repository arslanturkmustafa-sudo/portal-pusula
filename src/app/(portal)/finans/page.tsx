import type { Metadata } from "next";

import { FinancePageWorkspace } from "@/components/home/finance-page-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export const metadata: Metadata = {
  title: "Finans · Portal Pusula",
};

export default function FinancePage() {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Aylık hakedişleri, geçmiş alacakları ve tahsilatları takip edin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <FinancePageWorkspace />
    </>
  );
}
