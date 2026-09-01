import { expect, test } from "@playwright/test";

import { signIn } from "./auth";

const expectedCacheEntries = [
  "/icons/portal-pusula-192-v1.png",
  "/icons/portal-pusula-512-v1.png",
  "/icons/portal-pusula-maskable-512-v1.png",
  "/offline-v1.html",
];

test("exposes a valid standalone manifest and real-size icons", async ({
  page,
  request,
}) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toMatch(/manifest|json/i);
  const manifest = (await manifestResponse.json()) as {
    display: string;
    icons: { sizes: string; src: string }[];
  };
  expect(manifest.display).toBe("standalone");

  await signIn(page);
  for (const icon of manifest.icons) {
    const expectedSize = Number(icon.sizes.split("x")[0]);
    const dimensions = await page.evaluate(async ({ src }) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, icon);
    expect(dimensions).toEqual({
      width: expectedSize,
      height: expectedSize,
    });
  }
});

test("caches only the safe static allowlist and uses a neutral offline fallback", async ({
  context,
  page,
  request,
}) => {
  await signIn(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();

  const swResponse = await request.get("/sw.js");
  expect(swResponse.headers()["cache-control"]).toContain("no-store");
  expect(swResponse.headers()["content-type"]).toMatch(/javascript/i);
  expect(swResponse.headers()["service-worker-allowed"]).toBe("/");

  const cacheAudit = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        return {
          name,
          paths: requests.map((item) => new URL(item.url).pathname).sort(),
        };
      }),
    );
    return entries;
  });

  expect(cacheAudit).toEqual([
    {
      name: "portal-pusula-static-v1",
      paths: [...expectedCacheEntries].sort(),
    },
  ]);

  const clientStorage = await page.evaluate(async () => ({
    indexedDbNames:
      "databases" in indexedDB
        ? (await indexedDB.databases()).map((database) => database.name)
        : [],
    localStorageKeys: Object.keys(localStorage),
  }));
  expect(clientStorage).toEqual({ indexedDbNames: [], localStorageKeys: [] });

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("status")).toContainText(
    /güncel veriler gösterilemiyor/i,
  );

  const apiResult = await page.evaluate(() =>
    fetch("/api/health/live")
      .then(() => "resolved")
      .catch(() => "rejected"),
  );
  expect(apiResult).toBe("rejected");

  await page.goto("/offline-check");
  await expect(
    page.getByRole("heading", { name: "Bağlantı bekleniyor." }),
  ).toBeVisible();

  await context.setOffline(false);
});
