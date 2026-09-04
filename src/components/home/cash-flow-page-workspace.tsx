import { CashFlowWorkspace } from "@/components/home/cash-flow-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function CashFlowPageWorkspace() {
  return (
    <>
      <PortalPageHeader
        context="Likidite görünümü"
        note="Gerçekleşen nakit hareketlerini, yaklaşan yükümlülüklerden ve gecikmiş kalemlerden ayırın."
        title="Finans"
      />
      <FinanceSubnavigation />
      <CashFlowWorkspace />
    </>
  );
}
