// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  collection: vi.fn(),
  generate: vi.fn(),
  hasPermission: vi.fn(),
  opening: vi.fn(),
  parseCollection: vi.fn(),
  parseGenerate: vi.fn(),
  parseOpening: vi.fn(),
}));

vi.mock("@/features/finance", () => ({
  CollectionDateInFutureError: class extends Error {},
  CollectionExceedsOutstandingError: class extends Error {},
  CollectionAccountPermissionError: class extends Error {},
  ContractNotBillableError: class extends Error {},
  createCollectionInputSchema: { parse: mocks.parseCollection },
  createOpeningBalance: mocks.opening,
  createReceivableCollection: mocks.collection,
  FinanceAccountInactiveError: class extends Error {},
  FinanceAccountNotFoundError: class extends Error {},
  FinanceContractProjectMissingError: class extends Error {},
  FinanceCustomerProjectUnavailableError: class extends Error {},
  FinanceIdempotencyConflictError: class extends Error {},
  FinanceMonthOutsideContractError: class extends Error {},
  FinanceResourceNotFoundError: class extends Error {},
  FinanceTransactionBeforeAccountOpeningError: class extends Error {},
  FinanceTransactionFutureDateError: class extends Error {},
  FinanceTransactionIdempotencyConflictError: class extends Error {},
  generateContractMonthReceivable: mocks.generate,
  generateReceivableInputSchema: { parse: mocks.parseGenerate },
  openingBalanceInputSchema: { parse: mocks.parseOpening },
}));
vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticate,
}));
vi.mock("@/platform/auth/permissions", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: () => ({}),
}));
vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: () => ({}),
}));

import { POST as collect } from "@/app/api/finance/collections/route";
import { POST as generate } from "@/app/api/finance/receivables/generate/route";
import { POST as openBalance } from "@/app/api/finance/receivables/opening-balance/route";

const accountId = "10000000-0000-4000-8000-000000000001";

function request(pathname: string): NextRequest {
  return new NextRequest(`https://portal.example${pathname}`, {
    body: JSON.stringify({ value: "fixture" }),
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example",
    },
    method: "POST",
  });
}

describe("finance write-route audit actor bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ accountId, kind: "account" });
    mocks.hasPermission.mockReturnValue(true);
    mocks.parseCollection.mockImplementation((value: unknown) => value);
    mocks.parseGenerate.mockImplementation((value: unknown) => value);
    mocks.parseOpening.mockImplementation((value: unknown) => value);
    mocks.collection.mockResolvedValue({ created: true });
    mocks.generate.mockResolvedValue({ created: true });
    mocks.opening.mockResolvedValue({ created: true });
  });

  it.each([
    ["collection", collect, "/api/finance/collections", mocks.collection],
    [
      "opening balance",
      openBalance,
      "/api/finance/receivables/opening-balance",
      mocks.opening,
    ],
    [
      "generated receivable",
      generate,
      "/api/finance/receivables/generate",
      mocks.generate,
    ],
  ])("passes the authenticated account to the %s audit context", async (_label, handler, pathname, service) => {
    const response = await handler(request(pathname));

    expect(response.status).toBe(201);
    expect(service).toHaveBeenCalledWith(
      {},
      { value: "fixture" },
      expect.objectContaining(
        pathname === "/api/finance/collections"
          ? { actorId: accountId, canMutateAccountLedger: true }
          : { actorId: accountId },
      ),
    );
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "finance.receivables.write",
    );
  });
});
