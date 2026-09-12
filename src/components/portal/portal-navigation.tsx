"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  hasPermission,
  type PermissionCode,
  type PermissionPrincipal,
} from "@/platform/auth/permissions";

type PortalIconName =
  | "account"
  | "calendar"
  | "customers"
  | "finance"
  | "more"
  | "plus"
  | "projects"
  | "settings"
  | "tasks"
  | "users";

type PortalNavigationItem = Readonly<{
  href: string;
  icon: PortalIconName;
  label: string;
  permissions?: readonly PermissionCode[];
  shortLabel: string;
}>;

type PortalQuickAction = Readonly<{
  href: string;
  icon: PortalIconName;
  label: string;
  permissions: readonly PermissionCode[];
}>;

export const portalNavigationItems: readonly PortalNavigationItem[] = [
  {
    href: "/musteriler",
    icon: "customers",
    label: "Müşteriler",
    permissions: ["customers.read"],
    shortLabel: "Müşteri",
  },
  {
    href: "/gunluk-plan",
    icon: "calendar",
    label: "Günlük plan",
    permissions: ["daily-plan.read"],
    shortLabel: "Plan",
  },
  {
    href: "/gorevler",
    icon: "tasks",
    label: "Görevler",
    permissions: ["tasks.read"],
    shortLabel: "Görev",
  },
  {
    href: "/finans",
    icon: "finance",
    label: "Finans",
    permissions: [
      "finance.receivables.read",
      "finance.expenses.read",
      "finance.cards.read",
      "finance.accounts.read",
      "finance.partnership.read",
      "finance.taxes.read",
      "finance.reports.read",
    ],
    shortLabel: "Finans",
  },
  {
    href: "/projeler",
    icon: "projects",
    label: "Projeler",
    permissions: ["projects.read"],
    shortLabel: "Proje",
  },
  {
    href: "/kullanicilar",
    icon: "users",
    label: "Kullanıcılar",
    permissions: ["accounts.manage"],
    shortLabel: "Ekip",
  },
  {
    href: "/ayarlar",
    icon: "settings",
    label: "Ayarlar",
    permissions: ["accounts.manage"],
    shortLabel: "Ayar",
  },
  {
    href: "/hesabim",
    icon: "account",
    label: "Hesabım",
    shortLabel: "Hesap",
  },
];

const portalQuickActions: readonly PortalQuickAction[] = [
  {
    href: "/gunluk-plan",
    icon: "calendar",
    label: "Takvim",
    permissions: ["daily-plan.read"],
  },
  {
    href: "/finans/giderler?action=create",
    icon: "finance",
    label: "Gider ekle",
    permissions: ["finance.expenses.read", "finance.expenses.write"],
  },
  {
    href: "/gorevler?action=create",
    icon: "tasks",
    label: "Görev oluştur",
    permissions: [
      "tasks.read",
      "tasks.write",
      "customers.read",
      "projects.read",
    ],
  },
];

function PortalNavIcon({ name }: Readonly<{ name: PortalIconName }>) {
  const paths: Record<PortalIconName, React.ReactNode> = {
    customers: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
        <path d="m9 16 2 2 4-4" />
      </>
    ),
    tasks: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 8h7M9 12h7M9 16h4M7 8h.01M7 12h.01M7 16h.01" />
      </>
    ),
    finance: (
      <>
        <path d="M3 3v18h18" />
        <path d="m7 16 4-5 3 3 5-7" />
      </>
    ),
    projects: (
      <>
        <path d="M3 7h7l2 3h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h5l2 4" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    users: (
      <>
        <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <path d="M18 8v6M21 11h-6" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" fill="currentColor" />
        <circle cx="15" cy="12" r="2" fill="currentColor" />
        <circle cx="8" cy="18" r="2" fill="currentColor" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="ledger-nav-icon"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function canSeeItem(
  principal: PermissionPrincipal,
  item: PortalNavigationItem,
): boolean {
  return (
    item.permissions === undefined ||
    item.permissions.some((permission) => hasPermission(principal, permission))
  );
}

function canSeeQuickAction(
  principal: PermissionPrincipal,
  action: PortalQuickAction,
): boolean {
  return action.permissions.every((permission) =>
    hasPermission(principal, permission),
  );
}

function QuickActionLink({ action }: Readonly<{ action: PortalQuickAction }>) {
  return (
    <Link className="portal-quick-link" href={action.href}>
      <PortalNavIcon name={action.icon} />
      <span>{action.label}</span>
    </Link>
  );
}

function destinationForPrincipal(
  principal: PermissionPrincipal,
  item: PortalNavigationItem,
): PortalNavigationItem {
  if (item.icon !== "finance") return item;
  const destination = [
    ["finance.receivables.read", "/finans"],
    ["finance.accounts.read", "/finans/hesaplar"],
    ["finance.expenses.read", "/finans/giderler"],
    ["finance.cards.read", "/finans/kartlar"],
    ["finance.partnership.read", "/finans/ortaklik"],
    ["finance.taxes.read", "/finans/vergiler"],
    ["finance.reports.read", "/finans/raporlar"],
  ] as const satisfies readonly (readonly [PermissionCode, string])[];
  const href = destination.find(([permission]) =>
    hasPermission(principal, permission),
  )?.[1];
  if (href !== undefined && href !== item.href) return { ...item, href };
  return item;
}

function NavigationLink({
  item,
  pathname,
}: Readonly<{ item: PortalNavigationItem; pathname: string }>) {
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={active ? "is-active" : undefined}
      href={item.href}
    >
      <PortalNavIcon name={item.icon} />
      <span className="ledger-nav-label">{item.label}</span>
      <span className="ledger-nav-short" aria-hidden="true">
        {item.shortLabel}
      </span>
    </Link>
  );
}

export function PortalNavigation({
  principal,
}: Readonly<{ principal: PermissionPrincipal }>) {
  const pathname = usePathname();
  const items = portalNavigationItems
    .filter((item) => canSeeItem(principal, item))
    .map((item) => destinationForPrincipal(principal, item));
  const quickActions = portalQuickActions.filter((action) =>
    canSeeQuickAction(principal, action),
  );
  const primaryItems = items.filter(
    (item) => item.icon !== "account" && item.icon !== "users",
  ).slice(0, 4);
  const primaryHrefs = new Set(primaryItems.map((item) => item.href));
  const overflowItems = items.filter((item) => !primaryHrefs.has(item.href));
  const overflowActive = overflowItems.some((item) =>
    isActivePath(pathname, item.href),
  );

  return (
    <>
      {quickActions.length > 0 ? (
        <nav
          className="portal-quick-access portal-quick-access-desktop"
          aria-label="Hızlı ulaşım"
        >
          <p>Hızlı ulaşım</p>
          <div>
            {quickActions.map((action) => (
              <QuickActionLink action={action} key={action.href} />
            ))}
          </div>
        </nav>
      ) : null}

      <nav className="ledger-nav ledger-nav-desktop" aria-label="Ana navigasyon">
        {items.map((item) => (
          <NavigationLink item={item} key={item.href} pathname={pathname} />
        ))}
      </nav>

      <nav className="ledger-nav ledger-nav-mobile" aria-label="Mobil navigasyon">
        {primaryItems.map((item) => (
          <NavigationLink item={item} key={item.href} pathname={pathname} />
        ))}
        <details className="mobile-nav-more">
          <summary
            aria-label={
              quickActions.length > 0 ? "Hızlı ulaşım ve diğer sayfalar" : "Diğer sayfalar"
            }
            className={overflowActive ? "is-active" : undefined}
          >
            <PortalNavIcon name={quickActions.length > 0 ? "plus" : "more"} />
            <span>{quickActions.length > 0 ? "Hızlı" : "Diğer"}</span>
          </summary>
          <div className="mobile-nav-menu">
            {quickActions.length > 0 ? (
              <div className="mobile-nav-menu-section">
                <p>Hızlı ulaşım</p>
                {quickActions.map((action) => (
                  <QuickActionLink action={action} key={action.href} />
                ))}
              </div>
            ) : null}
            {overflowItems.length > 0 ? (
              <div className="mobile-nav-menu-section">
                <p>Diğer sayfalar</p>
                {overflowItems.map((item) => (
                  <NavigationLink item={item} key={item.href} pathname={pathname} />
                ))}
              </div>
            ) : null}
          </div>
        </details>
      </nav>
    </>
  );
}
