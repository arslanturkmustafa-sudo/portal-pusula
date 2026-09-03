import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PartnershipWorkspace } from "@/components/home/partnership-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function PartnershipPageWorkspace() {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Ortaklık komisyonlarını ve ortaktan alınacak gider katkılarını ayrı izleyin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <PartnershipWorkspace />
    </>
  );
}
