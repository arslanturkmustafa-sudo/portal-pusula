import type { Metadata } from "next";

import { ExpensesPageWorkspace } from "@/components/home/expenses-page-workspace";

export const metadata: Metadata = {
  title: "Giderler · Portal Pusula",
};

export default function ExpensesPage() {
  return <ExpensesPageWorkspace />;
}
