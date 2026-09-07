import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPool: vi.fn(() => ({ marker: "pool" })),
  registerMySqlPoolDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("mysql2/promise", () => ({ createPool: mocks.createPool }));
vi.mock("@/platform/database/mysql-session-contract", () => ({
  registerMySqlPoolDatabase: mocks.registerMySqlPoolDatabase,
}));

import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";

describe("platform database pool", () => {
  it("keeps two connections and a bounded wait queue for short request bursts", () => {
    const pool = getPlatformDatabasePool({
      DB_HOST: "127.0.0.1",
      DB_NAME: "portal_pusula_test",
      DB_PASSWORD: "fake-database-password",
      DB_PORT: 3306,
      DB_USER: "portal_pusula_test",
    });

    expect(pool).toEqual({ marker: "pool" });
    expect(mocks.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionLimit: 2,
        maxIdle: 2,
        queueLimit: 16,
        waitForConnections: true,
      }),
    );
    expect(mocks.registerMySqlPoolDatabase).toHaveBeenCalledWith(
      pool,
      "portal_pusula_test",
    );
  });
});
