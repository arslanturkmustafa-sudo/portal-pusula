import Link from "next/link";

import { PortalNavigation } from "@/components/portal/portal-navigation";

export function PortalShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#ana-icerik">
        Ana içeriğe geç
      </a>

      <div className="workbench-shell">
        <aside className="ledger-rail">
          <Link
            className="ledger-brand"
            href="/musteriler"
            aria-label="Portal Pusula müşteri sayfası"
          >
            <span className="ledger-brand-mark" aria-hidden="true">PP</span>
            <span>
              <strong>Portal Pusula</strong>
              <small>İş kayıt defteri</small>
            </span>
          </Link>

          <div className="ledger-workspace">
            <span>Çalışma alanı</span>
            <strong>Mühendis Kafası</strong>
          </div>

          <PortalNavigation />

          <div className="ledger-rail-footer">
            <span className="connection-dot" aria-hidden="true" />
            <span>
              <strong>İç kullanım</strong>
              <small>Yetkili erişim</small>
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
