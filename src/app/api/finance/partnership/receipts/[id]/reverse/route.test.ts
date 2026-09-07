// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  parse: vi.fn(),
  requestLogger: vi.fn(),
  reverse: vi.fn(),
}));
vi.mock("@/features/partnership-finance", () => ({
  PartnershipIdempotencyConflictError: class extends Error {},
  PartnershipReceiptAlreadyReversedError: class extends Error {},
  PartnershipReceiptNotReversibleError: class extends Error {},
  PartnershipRecordNotFoundError: class extends Error {},
  PartnershipVersionConflictError: class extends Error {},
  reverseContributionReceiptInputSchema: { parse: mocks.parse },
  reversePartnershipContributionReceipt: mocks.reverse,
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticate,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));
vi.mock("@/platform/logging/logger", () => ({ requestLogger: mocks.requestLogger }));

import { POST } from "./route";

const accountId = "10000000-0000-4000-8000-000000000001";
const receiptId = "20000000-0000-4000-8000-000000000001";

describe("partnership receipt reversal API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId, kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.reverse.mockResolvedValue({ created: false, reversal: { id: "reversal" } });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("uses the partnership reverse permission and returns replay as 200", async () => {
    const input = {
      clientOperationKey: "30000000-0000-4000-8000-000000000001",
      reason: "Yanlış hesaba işlendi",
    };
    const response = await POST(
      new NextRequest(`https://portal.example/api/finance/partnership/receipts/${receiptId}/reverse`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: receiptId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.anything(),
      "finance.partnership.reverse",
    );
    expect(mocks.reverse).toHaveBeenCalledWith(
      {},
      receiptId,
      input,
      expect.objectContaining({ actorId: accountId }),
    );
  });
});
