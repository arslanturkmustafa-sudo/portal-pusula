import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";
import { ProjectFinanceWorkspace } from "@/components/home/project-finance-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export function ProjectFinancePageWorkspace() {
  return (
    <>
      <PortalPageHeader
        context="Proje ekonomisi"
        note="Gelir, tahsilat ve giderleri ait oldukları projede birlikte okuyun."
        title="Finans"
      />
      <FinanceSubnavigation />
      <ProjectFinanceWorkspace />
    </>
  );
}
