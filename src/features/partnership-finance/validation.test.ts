import { describe, expect, it } from "vitest";

import {
  createCommissionInputSchema,
  createContributionReceiptInputSchema,
  createContributionInputSchema,
  updateCommissionInputSchema,
} from "./validation";

const operationKey = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";

describe("partnership finance validation", () => {
  it.each([
    ["partner_only", "0.1000"],
    ["user_one_side", "0.2500"],
    ["user_both", "0.5000"],
  ])("accepts the %s commission contribution mode", (contributionMode) => {
    const parsed = createCommissionInputSchema.parse({
      clientOperationKey: operationKey,
      closedOn: "2026-09-03",
      commissionBasisAmount: "100000",
      contributionMode,
      description: "Konut kiralama",
      projectId,
      transactionType: "rental",
    });
    expect(parsed.commissionBasisAmount).toBe("100000.0000");
    expect(parsed.status).toBe("expected");
  });

  it("requires chronological collection and payment dates", () => {
    expect(() => updateCommissionInputSchema.parse({
      agencyCollectedOn: "2026-09-02",
      closedOn: "2026-09-03",
      commissionBasisAmount: "10000",
      contributionMode: "user_both",
      description: "Satış",
      note: null,
      paidOn: "2026-09-01",
      projectId,
      status: "paid",
      transactionType: "sale",
      version: 1,
    })).toThrow();
  });

  it("defaults monthly contribution to zero expected receipt", () => {
    expect(createContributionInputSchema.parse({
      clientOperationKey: operationKey,
      contributionMonth: "2026-09",
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-09-15",
      expectedAmount: "7000",
      projectId,
    })).toMatchObject({
      expectedAmount: "7000.0000",
      status: "expected",
    });
  });

  it("accepts a positive receipt and rejects direct receipt fields on contribution", () => {
    expect(createContributionReceiptInputSchema.parse({
      amount: "3000",
      clientOperationKey: operationKey,
      receivedOn: "2026-09-16",
    }).amount).toBe("3000.0000");
    expect(() => createContributionInputSchema.parse({
      clientOperationKey: operationKey,
      contributionMonth: "2026-09",
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-09-15",
      expectedAmount: "7000",
      projectId,
      receivedAmount: "3000",
      receivedOn: "2026-09-16",
    })).toThrow();
  });

  it("rejects an impossible date or non-first-class month", () => {
    expect(() => createContributionInputSchema.parse({
      clientOperationKey: operationKey,
      contributionMonth: "2026-13",
      description: "Katkı",
      dueOn: "2026-02-30",
      expectedAmount: "7000",
      projectId,
    })).toThrow();
  });
});
