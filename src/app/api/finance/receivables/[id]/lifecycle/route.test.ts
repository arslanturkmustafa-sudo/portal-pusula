// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  parse: vi.fn(),
  requestLogger: vi.fn(),
  voidReceivable: vi.fn(),
}));
vi.mock("@/features/finance", () => ({
  FinanceResourceNotFoundError: class extends Error {},
  FinanceVersionConflictError: class extends Error {},
  ReceivableAlreadyVoidedError: class extends Error {},
  ReceivableHasCollectionsError: class extends Error {},
  receivableLifecycleInputSchema: { parse: mocks.parse },
  voidReceivable: mocks.voidReceivable,
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
vi.mock("@/platform/logging/logger", () => ({
  requestLogger: mocks.requestLogger,
}));

import { POST } from "./route";

const accountId = "10000000-0000-4000-8000-000000000001";
const receivableId = "20000000-0000-4000-8000-000000000001";

describe("receivable lifecycle API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId, kind: "account" });
    mocks.parse.mockImplementation((value: unknown) => value);
    mocks.voidReceivable.mockResolvedValue({ id: receivableId, recordState: "voided" });
    mocks.requestLogger.mockReturnValue({ error: vi.fn() });
  });

  it("requires the reverse permission and forwards actor, version and reason", async () => {
    const input = { action: "void", reason: "Mükerrer kayıt", version: 1 };
    const response = await POST(
      new NextRequest(`https://portal.example/api/finance/receivables/${receivableId}/lifecycle`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: receivableId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.anything(),
      "finance.receivables.reverse",
    );
    expect(mocks.voidReceivable).toHaveBeenCalledWith(
      {},
      receivableId,
      input,
      expect.objectContaining({ actorId: accountId }),
    );
  });

  it("does not parse an unauthorized write", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await POST(
      new NextRequest(`https://portal.example/api/finance/receivables/${receivableId}/lifecycle`, {
        body: "{}",
        headers: { "content-type": "application/json", origin: "https://portal.example" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: receivableId }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
