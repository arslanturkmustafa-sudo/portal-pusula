import Link from "next/link";

import { PortalNavigation } from "@/components/portal/portal-navigation";
import type { PermissionPrincipal } from "@/platform/auth/permissions";

type PortalShellProps = Readonly<{
  children: React.ReactNode;
  principal: PermissionPrincipal & Readonly<{ displayName: string; email: string }>;
}>;

export function PortalShell({ children, principal }: PortalShellProps) {
  return (
    <>
      <a className="skip-link" href="#ana-icerik">
        Ana içeriğe geç
      </a>

      <div className="workbench-shell">
        <aside className="ledger-rail">
          <Link
            className="ledger-brand"
            href="/"
            aria-label="Portal Pusula ana sayfası"
          >
            <span className="ledger-brand-mark" aria-hidden="true">PP</span>
            <span>
              <strong>Portal Pusula</strong>
              <small>Operasyon merkezi</small>
            </span>
          </Link>

          <div className="ledger-workspace">
            <span>Çalışma alanı</span>
            <strong>Mühendis Kafası</strong>
          </div>

          <PortalNavigation principal={principal} />

          <div className="ledger-rail-footer">
            <span className="connection-dot" aria-hidden="true" />
            <span>
              <strong>Güvenli çalışma alanı</strong>
              <small title={principal.email}>{principal.displayName}</small>
            </span>
          </div>
        </aside>

        <main className="workbench-main" id="ana-icerik" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
