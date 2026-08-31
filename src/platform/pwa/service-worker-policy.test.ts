import { describe, expect, it } from "vitest";

import { serviceWorkerSource } from "@/platform/pwa/service-worker-source";

describe("service worker cache policy", () => {
  const source = serviceWorkerSource;

  it("uses an explicit, versioned static allowlist", () => {
    expect(source).toContain('const CACHE_NAME = `${CACHE_PREFIX}v1`');
    expect(source).toContain('"/offline-v1.html"');
    expect(source).toContain('"/icons/portal-pusula-192-v1.png"');
    expect(source).not.toContain("/_next/static/");
  });

  it("never stores navigation, API, auth or business responses", () => {
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain('fetch(request, { cache: "no-store" })');
    expect(source).not.toContain("cache.put");
    expect(source).not.toMatch(/localStorage|indexedDB|pushManager|sync\.register/);
  });
});
