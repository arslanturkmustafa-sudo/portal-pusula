import { FinanceAccountsWorkspace } from "@/components/home/finance-accounts-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function FinanceAccountsPageWorkspace({
  canWrite,
}: Readonly<{ canWrite: boolean }>) {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Kasa ve banka bakiyelerini tek defterden, iz bırakan hareketlerle yönetin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <FinanceAccountsWorkspace canWrite={canWrite} />
    </>
  );
}
