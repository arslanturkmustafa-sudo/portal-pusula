import { redirect } from "next/navigation";

import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

const MODULE_HOMES: readonly Readonly<{
  href: string;
  permission: PermissionCode;
}>[] = [
  { href: "/musteriler", permission: "customers.read" },
  { href: "/gunluk-plan", permission: "daily-plan.read" },
  { href: "/gorevler", permission: "tasks.read" },
  { href: "/projeler", permission: "projects.read" },
  { href: "/finans", permission: "finance.receivables.read" },
  { href: "/finans/giderler", permission: "finance.expenses.read" },
  { href: "/finans/kartlar", permission: "finance.cards.read" },
  { href: "/finans/hesaplar", permission: "finance.accounts.read" },
  { href: "/finans/ortaklik", permission: "finance.partnership.read" },
  { href: "/finans/vergiler", permission: "finance.taxes.read" },
  { href: "/finans/raporlar", permission: "finance.reports.read" },
];

export default async function HomePage() {
  const principal = await authenticateCurrentPrincipal();
  if (!principal) redirect("/giris?next=%2F");
  const home = MODULE_HOMES.find(({ permission }) =>
    hasPermission(principal, permission),
  );
  redirect(home?.href ?? "/hesabim");
}
