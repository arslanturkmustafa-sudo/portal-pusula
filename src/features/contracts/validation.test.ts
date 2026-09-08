import { describe, expect, it } from "vitest";

import {
  createContractInputSchema,
  monthlyVisitPlanInputSchema,
  updateContractInputSchema,
  updateVisitResolutionInputSchema,
  updateVisitWithWorkItemsInputSchema,
} from "@/features/contracts/validation";

const projectId = "30000000-0000-4000-8000-000000000001";

describe("contract validation", () => {
  it("normalizes a 50.000 TL plus VAT agreement without floating point loss", () => {
    const result = createContractInputSchema.parse({
      endsOn: "2027-08-31",
      internalNote: "Yıllık danışmanlık anlaşması",
      monthlyFeeAmount: "50000",
      paymentDay: 5,
      projectId,
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
      projectId,
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
        projectId,
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
        projectId,
        startsOn: "2026-02-01",
        status: "active",
        vatMode: "exempt",
        vatRate: "0",
      }).success,
    ).toBe(false);
  });

  it("requires a canonical project id for every contract terms document", () => {
    const terms = {
      endsOn: "2027-08-31",
      internalNote: null,
      monthlyFeeAmount: "50000",
      paymentDay: 5,
      startsOn: "2026-09-01",
      vatMode: "exempt" as const,
      vatRate: "0",
    };

    expect(createContractInputSchema.safeParse(terms).success).toBe(false);
    expect(
      createContractInputSchema.safeParse({ ...terms, projectId: "PROJECT" })
        .success,
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
          locationLabel: "  Fabrika A  ",
        },
        {
          committedOn: "2026-09-17",
          internalDurationMinutes: null,
          internalStartTime: null,
          locationLabel: "   ",
        },
      ],
    });

    expect(result.visits).toHaveLength(2);
    expect(result.visits[0]?.locationLabel).toBe("Fabrika A");
    expect(result.visits[1]?.locationLabel).toBeNull();
    expect(
      monthlyVisitPlanInputSchema.safeParse({
        visits: [
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: "x".repeat(192),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate days and half-filled internal plans", () => {
    expect(
      monthlyVisitPlanInputSchema.safeParse({
        visits: [
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: null,
          },
          {
            committedOn: "2026-09-03",
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: null,
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
            locationLabel: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts existing visit ids and rejects duplicate visit identities", () => {
    const id = "30000000-0000-4000-8000-000000000001";
    expect(
      monthlyVisitPlanInputSchema.parse({
        visits: [
          {
            committedOn: "2026-09-03",
            id,
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: null,
          },
        ],
      }).visits[0]?.id,
    ).toBe(id);
    expect(
      monthlyVisitPlanInputSchema.safeParse({
        visits: [
          {
            committedOn: "2026-09-03",
            id,
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: null,
          },
          {
            committedOn: "2026-09-10",
            id,
            internalDurationMinutes: null,
            internalStartTime: null,
            locationLabel: null,
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

  it("normalizes non-empty visit work items and ignores blank rows", () => {
    const result = updateVisitWithWorkItemsInputSchema.parse({
      deliveredOn: "2026-09-03",
      resolutionNote: null,
      resolutionStatus: "completed",
      workItems: ["  Süreç akışı çıkarıldı  ", "", "   ", "Riskler paylaşıldı"],
    });

    expect(result.workItems).toEqual([
      "Süreç akışı çıkarıldı",
      "Riskler paylaşıldı",
    ]);
  });

  it("accepts identified append-only work items and rejects repeated identities", () => {
    const workItemId = "50000000-0000-4000-8000-000000000001";
    const base = {
      deliveredOn: "2026-09-03",
      resolutionNote: null,
      resolutionStatus: "completed" as const,
    };

    expect(
      updateVisitWithWorkItemsInputSchema.parse({
        ...base,
        workItems: [{ id: workItemId, title: "  Yeni uygulama  " }],
      }).workItems,
    ).toEqual([{ id: workItemId, title: "Yeni uygulama" }]);
    expect(
      updateVisitWithWorkItemsInputSchema.safeParse({
        ...base,
        workItems: [
          { id: workItemId, title: "İlk başlık" },
          { id: workItemId, title: "İkinci başlık" },
        ],
      }).success,
    ).toBe(false);
  });

  it("only accepts bounded work items for a completed visit", () => {
    const base = {
      deliveredOn: "2026-09-03",
      resolutionNote: null,
      resolutionStatus: "completed" as const,
    };

    expect(
      updateVisitWithWorkItemsInputSchema.safeParse({
        ...base,
        workItems: Array.from({ length: 21 }, () => "Çalışma"),
      }).success,
    ).toBe(false);
    expect(
      updateVisitWithWorkItemsInputSchema.safeParse({
        ...base,
        workItems: ["x".repeat(192)],
      }).success,
    ).toBe(false);
    expect(
      updateVisitWithWorkItemsInputSchema.safeParse({
        deliveredOn: null,
        resolutionNote: "Sonraki ziyarete taşındı",
        resolutionStatus: "makeup_pending",
        workItems: ["Tamamlanan çalışma"],
      }).success,
    ).toBe(false);
  });
});
