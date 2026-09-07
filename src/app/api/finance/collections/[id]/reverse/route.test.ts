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
vi.mock("@/features/finance", () => ({
  CollectionAlreadyReversedError: class extends Error {},
  CollectionNotReversibleError: class extends Error {},
  FinanceIdempotencyConflictError: class extends Error {},
  FinanceResourceNotFoundError: class extends Error {},
  ReceivableAlreadyVoidedError: class extends Error {},
  reverseCollectionInputSchema: { parse: mocks.parse },
  reverseReceivableCollection: mocks.reverse,
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
const collectionId = "20000000-0000-4000-8000-000000000001";

describe("receivable collection reversal API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId, kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.reverse.mockResolvedValue({ created: true, reversal: { id: "reversal" } });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("creates a same-origin, actor-attributed reversal", async () => {
    const input = {
      clientOperationKey: "30000000-0000-4000-8000-000000000001",
      reason: "Banka iadesi",
    };
    const response = await POST(
      new NextRequest(`https://portal.example/api/finance/collections/${collectionId}/reverse`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: collectionId }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.anything(),
      "finance.receivables.reverse",
    );
    expect(mocks.reverse).toHaveBeenCalledWith(
      {},
      collectionId,
      input,
      expect.objectContaining({ actorId: accountId }),
    );
  });
});
