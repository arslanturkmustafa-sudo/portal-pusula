import { describe, expect, it } from "vitest";

import {
  createTaxObligationInputSchema,
  updateTaxObligationInputSchema,
} from "./tax-validation";

const operationKey = "10000000-0000-4000-8000-000000000001";

describe("tax validation", () => {
  it("normalizes a VAT plan and keeps server calculation fields closed", () => {
    expect(
      createTaxObligationInputSchema.parse({
        clientOperationKey: operationKey,
        description: "Ağustos KDV",
        dueOn: "2026-09-28",
        manualAdjustmentAmount: "-12.5",
        periodMonth: "2026-08",
        taxType: "vat",
      }),
    ).toMatchObject({
      carriedVatCreditAmount: "0.0000",
      manualAdjustmentAmount: "-12.5000",
      paidOn: null,
      status: "planned",
      voidReason: null,
    });

    expect(() =>
      createTaxObligationInputSchema.parse({
        clientOperationKey: operationKey,
        description: "Ağustos KDV",
        dueOn: "2026-09-28",
        periodMonth: "2026-08",
        systemOutputVatAmount: "999999.0000",
        taxType: "vat",
      }),
    ).toThrow();
  });

  it("accepts accountant amounts only for income and provisional tax", () => {
    expect(
      createTaxObligationInputSchema.parse({
        accountantAmount: "15000",
        clientOperationKey: operationKey,
        description: "Geçici vergi",
        dueOn: "2026-11-17",
        periodMonth: "2026-09",
        taxType: "provisional_tax",
      }),
    ).toMatchObject({ accountantAmount: "15000.0000" });

    expect(() =>
      createTaxObligationInputSchema.parse({
        clientOperationKey: operationKey,
        description: "Gelir vergisi",
        dueOn: "2026-03-31",
        periodMonth: "2026-01",
        taxType: "income_tax",
      }),
    ).toThrow();
  });

  it("enforces paid and voided lifecycle shapes on updates", () => {
    const common = {
      accountantAmount: "1000",
      description: "Gelir vergisi",
      dueOn: "2026-09-30",
      note: null,
      periodMonth: "2026-08",
      taxType: "income_tax" as const,
      version: 2,
    };
    expect(() =>
      updateTaxObligationInputSchema.parse({
        ...common,
        paidOn: null,
        status: "paid",
        voidReason: null,
      }),
    ).toThrow();
    expect(
      updateTaxObligationInputSchema.parse({
        ...common,
        paidOn: null,
        status: "voided",
        voidReason: "Yanlış dönem seçildi",
      }),
    ).toMatchObject({ status: "voided" });
  });

  it("rejects impossible dates and periods", () => {
    expect(() =>
      createTaxObligationInputSchema.parse({
        clientOperationKey: operationKey,
        description: "KDV",
        dueOn: "2026-02-30",
        periodMonth: "2026-13",
        taxType: "vat",
      }),
    ).toThrow();
  });
});
