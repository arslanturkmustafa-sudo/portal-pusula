import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { OfflineStatus } from "@/components/pwa/offline-status";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Pusula",
  description:
    "Projeler, görevler, takvim ve finans akışı için günlük iç operasyon çalışma alanı.",
  applicationName: "Portal Pusula",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/portal-pusula-192-v1.png",
    apple: "/icons/portal-pusula-192-v1.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#101728",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <OfflineStatus />
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
