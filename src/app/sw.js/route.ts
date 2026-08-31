import { serviceWorkerSource } from "@/platform/pwa/service-worker-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return new Response(serviceWorkerSource, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      "Content-Security-Policy": "default-src 'self'",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
