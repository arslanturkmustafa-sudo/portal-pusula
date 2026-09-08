import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { TaxWorkspace } from "@/components/home/tax-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function TaxPageWorkspace({ canWrite }: Readonly<{ canWrite: boolean }>) {
  return (
    <>
      <PortalPageHeader
        context="Vergi takvimi"
        note="KDV hesabını, muhasebeci bildirimlerini ve vergi vadelerini tek yerde izleyin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <TaxWorkspace canWrite={canWrite} />
    </>
  );
}
