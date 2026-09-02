"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const portalNavigationItems = [
  { href: "/musteriler", label: "Müşteriler", shortLabel: "Müşteri" },
  { href: "/gunluk-plan", label: "Günlük plan", shortLabel: "Plan" },
  { href: "/gorevler", label: "Görevler", shortLabel: "Görev" },
  { href: "/finans", label: "Finans", shortLabel: "Finans" },
  { href: "/projeler", label: "Projeler", shortLabel: "Proje" },
  { href: "/hesabim", label: "Hesabım", shortLabel: "Hesap" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNavigation() {
  const pathname = usePathname();

  return (
    <nav className="ledger-nav" aria-label="Ana navigasyon">
      {portalNavigationItems.map((item, index) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            aria-label={item.label}
            className={active ? "is-active" : undefined}
            href={item.href}
            key={item.href}
            aria-current={active ? "page" : undefined}
          >
            <span className="ledger-nav-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="ledger-nav-label">{item.label}</span>
            <span className="ledger-nav-short" aria-hidden="true">
              {item.shortLabel}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
