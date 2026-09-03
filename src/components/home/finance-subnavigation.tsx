"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const financeSections = [
  { href: "/finans", label: "Alacaklar" },
  { href: "/finans/giderler", label: "Giderler" },
  { href: "/finans/kartlar", label: "Kartlar ve ödeme planı" },
] as const;

function isCurrentSection(pathname: string, href: string): boolean {
  return href === "/finans"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function FinanceSubnavigation() {
  const pathname = usePathname();

  return (
    <nav className="finance-subnav" aria-label="Finans bölümleri">
      {financeSections.map((section, index) => {
        const current = isCurrentSection(pathname, section.href);
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={current ? "is-current" : undefined}
            href={section.href}
            key={section.href}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <strong>{section.label}</strong>
          </Link>
        );
      })}
    </nav>
  );
}
