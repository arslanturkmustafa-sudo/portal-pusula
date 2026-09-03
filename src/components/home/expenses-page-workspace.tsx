import { ExpensesWorkspace } from "@/components/home/expenses-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function ExpensesPageWorkspace() {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Giderleri proje, KDV ve ödeme kaynağıyla takip edin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <ExpensesWorkspace />
    </>
  );
}
