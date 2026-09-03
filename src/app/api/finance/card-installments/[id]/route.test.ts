// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  class InstallmentPaymentDateInFutureError extends Error {}
  return { authenticate: vi.fn(), InstallmentPaymentDateInFutureError, parse: vi.fn(), requestLogger: vi.fn(), update: vi.fn() };
});
vi.mock("@/features/finance", () => ({
  InstallmentPaymentDateInFutureError: mocks.InstallmentPaymentDateInFutureError,
  SpendingResourceNotFoundError: class extends Error {},
  SpendingVersionConflictError: class extends Error {},
  updateCardInstallment: mocks.update,
  updateCardInstallmentInputSchema: { parse: mocks.parse },
}));
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { PATCH } from "@/app/api/finance/card-installments/[id]/route";

describe("card installment item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId: "10000000-0000-4000-8000-000000000001", kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("rejects a future paid date with a stable response", async () => {
    mocks.update.mockRejectedValue(new mocks.InstallmentPaymentDateInFutureError());
    const response = await PATCH(
      new NextRequest("https://portal.example/api/finance/card-installments/id", {
        body: JSON.stringify({ paidOn: "2099-01-01", status: "paid", version: 1 }),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "60000000-0000-4000-8000-000000000001" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: "payment_date_in_future" });
  });
});
