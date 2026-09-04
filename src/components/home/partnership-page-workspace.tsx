import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PartnershipWorkspace } from "@/components/home/partnership-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

type PartnershipPageWorkspaceProps = Readonly<{
  capabilities: Readonly<{
    canReadAudit: boolean;
    canReversePartnership: boolean;
  }>;
}>;

export function PartnershipPageWorkspace({ capabilities }: PartnershipPageWorkspaceProps) {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Ortaklık komisyonlarını ve ortaktan alınacak gider katkılarını ayrı izleyin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <PartnershipWorkspace capabilities={capabilities} />
    </>
  );
}
