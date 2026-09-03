import type { Metadata } from "next";

import { CardPlanPageWorkspace } from "@/components/home/card-plan-page-workspace";

export const metadata: Metadata = {
  title: "Kartlar ve ödeme planı · Portal Pusula",
};

export default function CardsPage() {
  return <CardPlanPageWorkspace />;
}
