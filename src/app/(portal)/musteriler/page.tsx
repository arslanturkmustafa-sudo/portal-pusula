import type { Metadata } from "next";

import { HomeScreen } from "@/components/home/home-screen";

export const metadata: Metadata = {
  title: "Müşteriler · Portal Pusula",
};

export default function CustomersPage() {
  return <HomeScreen live />;
}
