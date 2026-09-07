// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  listAuditHistoryRows: vi.fn(),
}));

vi.mock("./repository", () => ({
  listAuditHistoryRows: mocks.listAuditHistoryRows,
}));

import {
  AuditHistoryForbiddenError,
  getAuditHistory,
  redactAuditSummary,
} from "./service";
import type { AuthenticatedPrincipal } from "@/platform/auth/server-auth";

function member(
  permissions: AuthenticatedPrincipal["permissions"],
): AuthenticatedPrincipal {
  return {
    accountId: "10000000-0000-4000-8000-000000000001",
    credentialVersion: 1,
    displayName: "Operasyon",
    email: "operasyon@example.test",
    kind: "account",
    passwordChangedAtUtc: "2026-09-01T00:00:00.000Z",
    permissions,
    role: "member",
  };
}

describe("audit history service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires both audit and entity read permission before querying", async () => {
    await expect(
      getAuditHistory(
        {} as never,
        "customer",
        "10000000-0000-4000-8000-000000000001",
        member(["customers.read"]),
      ),
    ).rejects.toBeInstanceOf(AuditHistoryForbiddenError);
    expect(mocks.listAuditHistoryRows).not.toHaveBeenCalled();
  });

  it("rejects finance history for an audit reader without finance-account access", async () => {
    await expect(
      getAuditHistory(
        {} as never,
        "finance_transaction",
        "10000000-0000-4000-8000-000000000001",
        member(["audit.read"]),
      ),
    ).rejects.toBeInstanceOf(AuditHistoryForbiddenError);
    expect(mocks.listAuditHistoryRows).not.toHaveBeenCalled();
  });

  it("drops unknown, nested and secret-shaped values from summaries", () => {
    const result = redactAuditSummary(
      "customer",
      {
        displayName: "Atlas Makina",
        nested: { password: "redact-me" },
        password: "redact-me",
        status: "active",
        token: "redact-me",
      },
      member(["audit.read", "customers.read"]),
    );

    expect(result).toEqual({ displayName: "Atlas Makina", status: "active" });
    expect(JSON.stringify(result)).not.toContain("redact-me");
  });

  it("redacts contract billing fields without their separate grant", () => {
    const summary = {
      monthlyFeeAmount: "125000.0000",
      paymentDay: 5,
      status: "active",
      vatRate: "0.20",
    };
    expect(
      redactAuditSummary(
        "consulting_contract",
        summary,
        member(["audit.read", "contracts.read"]),
      ),
    ).toEqual({ status: "active" });
    expect(
      redactAuditSummary(
        "consulting_contract",
        summary,
        member([
          "audit.read",
          "contracts.read",
          "contracts.billing.read",
        ]),
      ),
    ).toEqual(summary);
  });

  it("keeps only allowlisted reversal identities and state fields", () => {
    expect(
      redactAuditSummary(
        "receivable",
        {
          recordState: "voided",
          reason: "Mükerrer kayıt",
          unknownState: "hidden",
        },
        member(["audit.read", "finance.receivables.read"]),
      ),
    ).toEqual({ recordState: "voided", reason: "Mükerrer kayıt" });
    expect(
      redactAuditSummary(
        "receivable_collection",
        {
          originalCollectionId: "50000000-0000-4000-8000-000000000001",
          reason: "Hatalı tahsilat",
        },
        member(["audit.read", "finance.receivables.read"]),
      ),
    ).toEqual({
      originalCollectionId: "50000000-0000-4000-8000-000000000001",
      reason: "Hatalı tahsilat",
    });
  });

  it("returns a minimal finance transaction summary without internal operation data", () => {
    const result = redactAuditSummary(
      "finance_transaction",
      {
        amount: "125.0000",
        clientOperationKey: "redact-operation-key",
        createdAtUtc: "2026-09-07 09:00:00.000000",
        description: "Kasa aktarımı",
        occurredOn: "2026-09-07",
        reversalReason: "Mükerrer kayıt",
        sourceAccountId: "20000000-0000-4000-8000-000000000001",
        targetAccountId: "20000000-0000-4000-8000-000000000002",
        transactionType: "transfer",
      },
      member(["audit.read", "finance.accounts.read"]),
    );
    expect(result).toEqual({
      amount: "125.0000",
      description: "Kasa aktarımı",
      occurredOn: "2026-09-07",
      reversalReason: "Mükerrer kayıt",
      sourceAccountId: "20000000-0000-4000-8000-000000000001",
      targetAccountId: "20000000-0000-4000-8000-000000000002",
      transactionType: "transfer",
    });
    expect(JSON.stringify(result)).not.toContain("redact-operation-key");
    expect(result).not.toHaveProperty("createdAtUtc");
  });

  it("maps actor labels and redacts every row before returning it", async () => {
    mocks.listAuditHistoryRows.mockResolvedValueOnce([
      {
        action: "archive",
        actorDisplayName: "Ayşe",
        actorType: "user",
        afterSummary: {
          reason: "Müşteri talebi",
          status: "archived",
          token: "redact-me",
        },
        beforeSummary: { status: "active" },
        id: "20000000-0000-4000-8000-000000000001",
        occurredAtUtc: "2026-09-04T08:00:00.000Z",
      },
    ]);

    const result = await getAuditHistory(
      {} as never,
      "customer",
      "10000000-0000-4000-8000-000000000001",
      member(["audit.read", "customers.read"]),
    );

    expect(result).toEqual([
      expect.objectContaining({
        action: "archive",
        actorLabel: "Ayşe",
        after: { reason: "Müşteri talebi", status: "archived" },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("sentinel-token");
  });
});
