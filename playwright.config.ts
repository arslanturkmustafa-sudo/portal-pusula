import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const externalServer = process.env.PORTAL_PUSULA_E2E_EXTERNAL_SERVER === "1";
const externalBaseUrl = process.env.PORTAL_PUSULA_E2E_BASE_URL;

function resolvedBaseUrl(): string {
  if (!externalServer) {
    return `http://127.0.0.1:${port}`;
  }

  if (externalBaseUrl === undefined) {
    throw new Error("External E2E base URL is missing.");
  }

  const parsed = new URL(externalBaseUrl);
  const parsedPort = Number(parsed.port);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !Number.isSafeInteger(parsedPort) ||
    parsedPort < 1_024 ||
    parsedPort > 65_535
  ) {
    throw new Error("External E2E base URL is invalid.");
  }

  return parsed.origin;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: resolvedBaseUrl(),
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: externalServer
    ? undefined
    : {
        command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
        url: `http://127.0.0.1:${port}/api/health/live`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
