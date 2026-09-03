import type { Metadata } from "next";

import { PartnershipPageWorkspace } from "@/components/home/partnership-page-workspace";

export const metadata: Metadata = {
  title: "Ortaklık hesabı · Portal Pusula",
};

export default function PartnershipPage() {
  return <PartnershipPageWorkspace />;
}
