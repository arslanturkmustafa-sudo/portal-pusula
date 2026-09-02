import type { Metadata } from "next";

import { AccountWorkspace } from "@/components/home/account-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

export const metadata: Metadata = {
  title: "Hesabım · Portal Pusula",
};

export default function AccountPage() {
  return (
    <>
      <PortalPageHeader
        context="Hesap ve güvenlik"
        note="Giriş bilgilerinizi ve uygulama parolanızı yönetin."
        title="Hesabım"
      />
      <AccountWorkspace live />
    </>
  );
}
