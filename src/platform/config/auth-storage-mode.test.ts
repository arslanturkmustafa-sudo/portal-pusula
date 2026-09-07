// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAuthStorageMode } from "@/platform/config/auth-storage-mode";

describe("authentication storage mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to database-backed fail-closed authentication", () => {
    vi.stubEnv("PORTAL_PUSULA_AUTH_STORAGE_MODE", undefined);
    expect(getAuthStorageMode()).toBe("database");
  });

  it("accepts only the exact environment compatibility mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PORTAL_PUSULA_AUTH_STORAGE_MODE", "environment");
    expect(getAuthStorageMode()).toBe("environment");

    vi.stubEnv("PORTAL_PUSULA_AUTH_STORAGE_MODE", " environment ");
    expect(() => getAuthStorageMode()).toThrow(
      "Authentication storage mode is invalid.",
    );
  });

  it("rejects environment authentication in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PORTAL_PUSULA_AUTH_STORAGE_MODE", "environment");
    expect(() => getAuthStorageMode()).toThrow(
      "Environment authentication mode is disabled in production.",
    );
  });
});
