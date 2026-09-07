// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class ManagedUserEmailConflictError extends Error {}
  class ManagedUserNotFoundError extends Error {}
  class ManagedUserOwnerProtectedError extends Error {}
  class ManagedUserVersionConflictError extends Error {}
  return {
    authenticatePrincipalRequest: vi.fn(),
    createManagedUser: vi.fn(),
    listManagedUsers: vi.fn(),
    ManagedUserEmailConflictError,
    ManagedUserNotFoundError,
    ManagedUserOwnerProtectedError,
    ManagedUserVersionConflictError,
    parseCreate: vi.fn(),
    parseUpdate: vi.fn(),
    updateManagedUser: vi.fn(),
  };
});

vi.mock("@/features/account", () => ({
  createManagedUser: mocks.createManagedUser,
  createManagedUserInputSchema: { parse: mocks.parseCreate },
  listManagedUsers: mocks.listManagedUsers,
  ManagedUserEmailConflictError: mocks.ManagedUserEmailConflictError,
  ManagedUserNotFoundError: mocks.ManagedUserNotFoundError,
  ManagedUserOwnerProtectedError: mocks.ManagedUserOwnerProtectedError,
  ManagedUserVersionConflictError: mocks.ManagedUserVersionConflictError,
  updateManagedUser: mocks.updateManagedUser,
  updateManagedUserInputSchema: { parse: mocks.parseUpdate },
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticatePrincipalRequest: mocks.authenticatePrincipalRequest,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { GET, POST } from "@/app/api/users/route";
import { PATCH } from "@/app/api/users/[id]/route";

const accountId = "10000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000002";
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
const user = {
  displayName: "Operasyon Kullanıcısı",
  email: "operasyon@example.com",
  id: memberId,
  permissions: ["tasks.read"],
  role: "member",
  status: "active",
};

function writeRequest(path = "/api/users", origin = "https://portal.example.test") {
  return new NextRequest(`https://portal.example.test${path}`, {
    body: JSON.stringify({ permissions: ["tasks.read"], status: "active" }),
    headers: {
      "content-type": "application/json",
      origin,
      "x-correlation-id": "55555555-5555-4555-8555-555555555555",
    },
    method: path === "/api/users" ? "POST" : "PATCH",
  });
}

describe("managed user API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePrincipalRequest.mockResolvedValue(principal);
    mocks.createManagedUser.mockResolvedValue(user);
    mocks.listManagedUsers.mockResolvedValue([user]);
    mocks.parseCreate.mockImplementation((value: unknown) => value);
    mocks.parseUpdate.mockImplementation((value: unknown) => value);
    mocks.updateManagedUser.mockResolvedValue(user);
  });

  it("distinguishes unauthenticated, unauthorized and non-account owners", async () => {
    mocks.authenticatePrincipalRequest.mockResolvedValueOnce(null);
    expect((await GET(new NextRequest("https://portal.example.test/api/users"))).status).toBe(401);

    mocks.authenticatePrincipalRequest.mockResolvedValueOnce({
      ...principal,
      permissions: ["tasks.read"],
      role: "member",
    });
    expect((await GET(new NextRequest("https://portal.example.test/api/users"))).status).toBe(403);

    mocks.authenticatePrincipalRequest.mockResolvedValueOnce({
      displayName: "Geçiş yöneticisi",
      email: "legacy@example.com",
      kind: "legacy",
      permissions: [],
      role: "owner",
    });
    expect((await GET(new NextRequest("https://portal.example.test/api/users"))).status).toBe(409);
  });

  it("lists users only for a database-backed account manager", async () => {
    const response = await GET(new NextRequest("https://portal.example.test/api/users"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ users: [user] });
  });

  it("creates a member with the authenticated owner as audit actor", async () => {
    const response = await POST(writeRequest());
    expect(response.status).toBe(201);
    expect(mocks.createManagedUser).toHaveBeenCalledWith(
      {},
      { permissions: ["tasks.read"], status: "active" },
      {
        actorId: accountId,
        correlationId: "55555555-5555-4555-8555-555555555555",
      },
    );
  });

  it("rejects cross-origin management writes before mutation", async () => {
    expect((await POST(writeRequest("/api/users", "https://attacker.example"))).status).toBe(403);
    expect(mocks.createManagedUser).not.toHaveBeenCalled();
  });

  it("protects owner accounts and maps optimistic conflicts", async () => {
    mocks.updateManagedUser.mockRejectedValueOnce(
      new mocks.ManagedUserOwnerProtectedError(),
    );
    const context = { params: Promise.resolve({ id: memberId }) };
    expect((await PATCH(writeRequest(`/api/users/${memberId}`), context)).status).toBe(409);

    mocks.updateManagedUser.mockRejectedValueOnce(
      new mocks.ManagedUserVersionConflictError(),
    );
    expect((await PATCH(writeRequest(`/api/users/${memberId}`), context)).status).toBe(409);
  });
});
