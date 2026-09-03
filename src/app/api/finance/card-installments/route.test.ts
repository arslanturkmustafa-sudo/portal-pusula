// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), list: vi.fn(), parse: vi.fn() }));
vi.mock("@/features/finance", () => ({
  installmentListFilterSchema: { parse: mocks.parse },
  listCardInstallments: mocks.list,
}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));

import { GET } from "@/app/api/finance/card-installments/route";

describe("card installment collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.list.mockResolvedValue({ installments: [], summary: {} });
  });

  it("lists an exact month and card filter", async () => {
    const cardId = "20000000-0000-4000-8000-000000000001";
    const response = await GET(
      new NextRequest(`https://portal.example/api/finance/card-installments?month=2026-09&cardId=${cardId}`),
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({}, { cardId, month: "2026-09" });
  });
});
