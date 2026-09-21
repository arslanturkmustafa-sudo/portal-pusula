// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticatePrincipalRequest: vi.fn() }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: vi.fn() }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: vi.fn() }));
vi.mock("@/features/bypusula/service", async (original) => {
  const real = await original<typeof import("@/features/bypusula/service")>();
  return { ...real, receiveTransfer: vi.fn(), importTransfer: vi.fn(), listTransfers: vi.fn() };
});
import { authenticatePrincipalRequest, type AuthenticatedPrincipal } from "@/platform/auth/server-auth";
import { receiveTransfer } from "@/features/bypusula/service";
import { exampleEnvelope } from "@/features/bypusula/fixtures.test-support";
import { GET, POST } from "./route";

const principal: AuthenticatedPrincipal = {
  kind: "account", role: "member", accountId: "55555555-5555-4555-8555-555555555555",
  credentialVersion: 1, displayName: "Test User", email: "test@example.invalid", passwordChangedAtUtc: "2026-09-17 00:00:00.000000",
  permissions: ["tasks.read", "tasks.write", "customers.read", "projects.read"],
};
function request(origin = "https://portal.example", body: unknown = { action: "preview", envelope: exampleEnvelope }) {
  return new NextRequest("https://portal.example/api/integrations/bypusula", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(authenticatePrincipalRequest).mockResolvedValue(principal); });

it("fails closed for missing sessions, each missing permission and non-account principals", async () => {
  for (const denied of [null, { ...principal, kind: "legacy", role: "owner" }, { ...principal, kind: "development", role: "owner" },
    ...principal.permissions.map((missing) => ({ ...principal, permissions: principal.permissions.filter((permission) => permission !== missing) }))]) {
    vi.mocked(authenticatePrincipalRequest).mockResolvedValue(denied as AuthenticatedPrincipal | null);
    expect([401, 403]).toContain((await POST(request())).status);
    expect([401, 403]).toContain((await GET(new NextRequest("https://portal.example/api/integrations/bypusula"))).status);
  }
  expect(receiveTransfer).not.toHaveBeenCalled();
});

it("rejects cross-origin and oversized payloads, and returns no raw failure details", async () => {
  expect((await POST(request("https://elsewhere.example"))).status).toBe(403);
  expect((await POST(request("https://portal.example", { padding: "x".repeat(524_289) }))).status).toBe(400);
  expect(receiveTransfer).not.toHaveBeenCalled();
  vi.mocked(receiveTransfer).mockRejectedValue(new Error("private SQL details"));
  const result = await POST(request());
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("private SQL");
  expect(result.headers.get("Cache-Control")).toContain("no-store");
});
