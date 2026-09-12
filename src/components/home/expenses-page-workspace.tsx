import { ExpensesWorkspace } from "@/components/home/expenses-workspace";
import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

type ExpensesPageWorkspaceProps = Readonly<{
  capabilities: Readonly<{
    canReadAudit: boolean;
    canReadAccounts: boolean;
    canReverseExpenses: boolean;
    canWriteAccounts: boolean;
    canWriteExpenses: boolean;
  }>;
  initialCreate?: boolean;
}>;

export function ExpensesPageWorkspace({
  capabilities,
  initialCreate = false,
}: ExpensesPageWorkspaceProps) {
  return (
    <>
      <PortalPageHeader
        context="Finans masası"
        note="Giderleri proje, KDV ve ödeme kaynağıyla takip edin."
        title="Finans"
      />
      <FinanceSubnavigation />
      <ExpensesWorkspace
        capabilities={capabilities}
        initialCreate={initialCreate}
        key={initialCreate ? "quick-create" : "workspace"}
      />
    </>
  );
}
