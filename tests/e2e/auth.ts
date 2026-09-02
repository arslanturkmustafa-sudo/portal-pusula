import { expect, type Page } from "@playwright/test";

export const e2eAdminEmail = "e2e-admin@example.test";
export const e2eAdminPassword = "fake-e2e-password";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(e2eAdminEmail);
  await page.getByLabel("Parola").fill(e2eAdminPassword);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/musteriler$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Müşteriler" }),
  ).toBeVisible();
}
