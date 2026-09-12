import { CardPlanWorkspace } from "@/components/home/card-plan-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function CardPlanPageWorkspace({
  canManagePayments,
  canWrite,
}: Readonly<{ canManagePayments: boolean; canWrite: boolean }>) {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Kartları tanımlayın, taksitleri ve yaklaşan ödemeleri takip edin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <CardPlanWorkspace
        canManagePayments={canManagePayments}
        canWrite={canWrite}
      />
    </>
  );
}
