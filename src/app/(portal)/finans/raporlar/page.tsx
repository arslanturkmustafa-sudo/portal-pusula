import type { Metadata } from "next";

import { ProjectFinancePageWorkspace } from "@/components/home/project-finance-page-workspace";

export const metadata: Metadata = {
  title: "Proje görünümü · Portal Pusula",
};

export default function ProjectFinanceReportPage() {
  return <ProjectFinancePageWorkspace />;
}
