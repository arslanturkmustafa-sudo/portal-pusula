// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  get: vi.fn(),
  parse: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/features/settings", () => ({
  getNotificationSettings: mocks.get,
  updateNotificationSettings: mocks.update,
  updateNotificationSettingsInputSchema: { parse: mocks.parse },
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticatePrincipalRequest: mocks.authenticate,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { GET, PATCH } from "./route";

const accountId = "10000000-0000-4000-8000-000000000001";
const principal = {
  accountId,
  credentialVersion: 1,
  displayName: "Portal Sahibi",
  email: "owner@example.com",
  kind: "account" as const,
  passwordChangedAtUtc: "2026-09-01 09:00:00.000000",
  permissions: [] as const,
  role: "owner" as const,
};
const settings = {
  recipientEmail: "bildirim@example.com",
  usesAccountEmail: false,
};

function patchRequest(origin = "https://portal.example.test") {
  return new NextRequest(
    "https://portal.example.test/api/settings/notifications",
    {
      body: JSON.stringify({ recipientEmail: "bildirim@example.com" }),
      headers: {
        "content-type": "application/json",
        origin,
        "x-correlation-id": "55555555-5555-4555-8555-555555555555",
      },
      method: "PATCH",
    },
  );
}

describe("notification settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(principal);
    mocks.get.mockResolvedValue(settings);
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.update.mockResolvedValue(settings);
  });

  it("allows only a database-backed owner", async () => {
    mocks.authenticate.mockResolvedValueOnce(null);
    expect((await GET(new NextRequest("https://portal.example.test/api/settings/notifications"))).status).toBe(401);

    mocks.authenticate.mockResolvedValueOnce({ ...principal, role: "member" });
    expect((await GET(new NextRequest("https://portal.example.test/api/settings/notifications"))).status).toBe(403);

    mocks.authenticate.mockResolvedValueOnce({ ...principal, kind: "legacy" });
    expect((await GET(new NextRequest("https://portal.example.test/api/settings/notifications"))).status).toBe(409);
  });

  it("returns private no-store settings", async () => {
    const response = await GET(
      new NextRequest("https://portal.example.test/api/settings/notifications"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ settings });
  });

  it("updates only through a same-origin JSON request and audits as the owner", async () => {
    const response = await PATCH(patchRequest());
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      {},
      accountId,
      { recipientEmail: "bildirim@example.com" },
      {
        actorId: accountId,
        correlationId: "55555555-5555-4555-8555-555555555555",
      },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a cross-origin update before mutation", async () => {
    expect((await PATCH(patchRequest("https://attacker.example"))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
