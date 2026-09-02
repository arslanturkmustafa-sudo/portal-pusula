import { expect, test } from "@playwright/test";

import { signIn } from "./auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("protects and renders the accessible customer workbench", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/giris$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Çalışma alanına giriş" }),
  ).toBeVisible();

  await signIn(page);
  const response = await page.reload();

  await expect(
    page.getByRole("heading", { level: 1, name: "Müşteriler" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Ana navigasyon" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Müşteri kayıtları" }),
  ).toBeVisible();
  await expect(page.getByText("Atlas Makina")).toHaveCount(0);

  const skipLink = page.getByRole("link", { name: "Ana içeriğe geç" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#ana-icerik")).toBeFocused();

  await page.getByRole("link", { name: "Günlük plan" }).click();
  await expect(page).toHaveURL(/\/gunluk-plan$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Günlük plan" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Müşteriler" }).click();
  await expect(page).toHaveURL(/\/musteriler$/u);

  await expect(
    page.getByRole("heading", { name: /İşlerinizi tek bir yerde/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Temeli incele" })).toHaveCount(0);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-correlation-id"]).toMatch(UUID_PATTERN);
});

test("has no page-level horizontal overflow", async ({ page }, testInfo) => {
  await signIn(page);

  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(
    widths.document,
    `${testInfo.project.name} document yatay taşma üretiyor`,
  ).toBeLessThanOrEqual(widths.viewport + 1);
  expect(
    widths.body,
    `${testInfo.project.name} body yatay taşma üretiyor`,
  ).toBeLessThanOrEqual(widths.viewport + 1);
});

test("public liveness is minimal and protected readiness fails closed", async ({
  request,
}) => {
  const first = await request.get("/api/health/live");
  const second = await request.get("/api/health/live");

  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ status: "ok" });
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect(first.headers()["x-correlation-id"]).toMatch(UUID_PATTERN);
  expect(second.headers()["x-correlation-id"]).toMatch(UUID_PATTERN);
  expect(second.headers()["x-correlation-id"]).not.toBe(
    first.headers()["x-correlation-id"],
  );

  const readiness = await request.get("/api/internal/readiness");
  expect(readiness.status()).toBe(404);
  expect(await readiness.json()).toEqual({ status: "not_found" });
  expect(readiness.headers()["cache-control"]).toContain("no-store");

  const customers = await request.get("/api/customers");
  expect(customers.status()).toBe(401);
  expect(await customers.json()).toEqual({ status: "unauthorized" });
});

test("keeps the internal cron candidate disabled by default", async ({
  request,
}) => {
  const wrongMethod = await request.get("/api/internal/cron/dispatch");
  const disabledPost = await request.post("/api/internal/cron/dispatch");

  for (const response of [wrongMethod, disabledPost]) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ status: "not_found" });
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-correlation-id"]).toMatch(UUID_PATTERN);
  }
});
