import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portal Pusula",
    short_name: "Pusula",
    description:
      "Müşteri, planlama, görev ve finans süreçleri için güvenli yönetim çalışma alanı.",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#101728",
    orientation: "any",
    icons: [
      {
        src: "/icons/portal-pusula-192-v1.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/portal-pusula-512-v1.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/portal-pusula-maskable-512-v1.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
