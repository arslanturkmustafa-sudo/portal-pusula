export const serviceWorkerSource = `const CACHE_PREFIX = "portal-pusula-static-";
const CACHE_NAME = \`\${CACHE_PREFIX}v1\`;
const STATIC_ALLOWLIST = [
  "/offline-v1.html",
  "/icons/portal-pusula-192-v1.png",
  "/icons/portal-pusula-512-v1.png",
  "/icons/portal-pusula-maskable-512-v1.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ALLOWLIST)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (STATIC_ALLOWLIST.includes(url.pathname) && url.search === "") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(url.pathname);
        return cached ?? fetch(request);
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match("/offline-v1.html");
        return offline ?? Response.error();
      }),
    );
  }
});
`;
