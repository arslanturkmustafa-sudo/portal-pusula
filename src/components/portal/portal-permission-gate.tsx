import Link from "next/link";
import { redirect } from "next/navigation";

import { hasPermission, type PermissionCode } from "@/platform/auth/permissions";
import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";

type PortalPermissionGateProps = Readonly<{
  anyOf: readonly PermissionCode[];
  children: React.ReactNode;
}>;

export async function PortalPermissionGate({
  anyOf,
  children,
}: PortalPermissionGateProps) {
  const principal = await authenticateCurrentPrincipal();
  if (!principal) redirect("/giris");

  if (!anyOf.some((permission) => hasPermission(principal, permission))) {
    return (
      <section className="portal-access-denied" aria-labelledby="access-denied-title">
        <p className="eyebrow">ERİŞİM SINIRI</p>
        <h1 id="access-denied-title">Bu modül hesabınıza açık değil</h1>
        <p>
          Veriler sunucu tarafında korunuyor. Erişim ihtiyacınız varsa hesap
          yöneticinizden bu modülün yetkisini istemelisiniz.
        </p>
        <Link className="text-action" href="/hesabim">
          Hesabımı görüntüle
        </Link>
      </section>
    );
  }

  return children;
}
