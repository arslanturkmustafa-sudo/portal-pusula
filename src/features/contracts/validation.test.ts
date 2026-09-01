import { describe, expect, it } from "vitest";

import {
  createContractInputSchema,
  monthlyVisitPlanInputSchema,
  updateContractInputSchema,
  updateVisitResolutionInputSchema,
} from "@/features/contracts/validation";

describe("contract validation", () => {
  it("normalizes a 50.000 TL plus VAT agreement without floating point loss", () => {
    const result = createContractInputSchema.parse({
      endsOn: "2027-08-31",
      internalNote: "Yıllık danışmanlık anlaşması",
      monthlyFeeAmount: "50000",
      paymentDay: 5,
      startsOn: "2026-09-01",
      vatMode: "exclusive",
      vatRate: "20",
    });

    expect(result.monthlyFeeAmount).toBe("50000.0000");
    expect(result.vatRate).toBe("20.00");
    expect(result.status).toBe("active");
  });

  it("rejects incompatible VAT, numeric money and impossible dates", () => {
    const base = {
      endsOn: "2027-08-31",
      internalNote: null,
      monthlyFeeAmount: "50000",
      paymentDay: 5,
      startsOn: "2026-09-01",
      vatMode: "exempt",
      vatRate: "0",
    } as const;

    expect(
      createContractInputSchema.safeParse({ ...base, vatRate: "20" }).success,
    ).toBe(false);
    expect(
      createContractInputSchema.safeParse({
        ...base,
        monthlyFeeAmount: 50_000,
      }).success,
    ).toBe(false);
    expect(
      createContractInputSchema.safeParse({ ...base, startsOn: "2026-02-30" })
        .success,
    ).toBe(false);
  });

  it("rejects an edited contract whose end precedes its start", () => {
    expect(
      updateContractInputSchema.safeParse({
        endsOn: "2026-01-31",
        internalNote: null,
        monthlyFeeAmount: "60000",
        paymentDay: 15,
        startsOn: "2026-02-01",
        status: "active",
        vatMode: "exempt",
        vatRate: "0",
      }).success,
    ).toBe(false);
  });

  it("requires the complete current terms document for an edit", () => {
    expect(
      updateContractInputSchema.safeParse({
        endsOn: "2026-12-31",
        monthlyFeeAmount: "60000",
        paymentDay: 15,
        startsOn: "2026-02-01",
        status: "active",
        vatMode: "exempt",
        vatRate: "0",
      }).success,
    ).toBe(false);
  });
});

describe("monthly visit validation", () => {
  it("accepts date-only promises with optional paired internal time and duration", () => {
    const result = monthlyVisitPlanInputSchema.parse({
      visits: [
        {
          committedOn: "2026-09-03",
          internalDurationMinutes: 240,
          internalStartTime: "09:00",
        },
        {
          committedOn: "2026-09-17",
          internalDurationMinutes: null,
          internalStartTime: null,
        },
      ],
    });

    expect(result.visits).toHaveLength(2);
  });

  it("rejects duplicate days and half-filled internal plans", () => {
    expect(
      monthlyVisitPlanInputSchema.safeParse({
        visits: [
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: null,
            internalStartTime: null,
          },
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: null,
            internalStartTime: null,
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      monthlyVisitPlanInputSchema.safeParse({
        visits: [
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: null,
            internalStartTime: "09:00",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires a delivered day for completion and a note for agreed cancellation", () => {
    expect(
      updateVisitResolutionInputSchema.safeParse({
        deliveredOn: null,
        resolutionNote: null,
        resolutionStatus: "completed",
      }).success,
    ).toBe(false);
    expect(
      updateVisitResolutionInputSchema.safeParse({
        deliveredOn: null,
        resolutionNote: null,
        resolutionStatus: "cancelled_by_agreement",
      }).success,
    ).toBe(false);
  });
});
