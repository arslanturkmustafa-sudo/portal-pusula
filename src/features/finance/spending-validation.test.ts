import { describe, expect, it } from "vitest";

import {
  createCreditCardInputSchema,
  createExpenseInputSchema,
  updateCardInstallmentInputSchema,
  updateExpenseInputSchema,
} from "@/features/finance/spending-validation";

const operationKey = "40000000-0000-4000-8000-000000000001";
const recordId = "30000000-0000-4000-8000-000000000001";

const expense = {
  category: "software_subscription" as const,
  creditCardId: null,
  description: "Bulut hizmeti",
  documentNumber: null,
  documentType: "invoice" as const,
  incurredOn: "2026-09-03",
  installmentCount: 1,
  netAmount: "100",
  note: null,
  paymentMethod: "bank_transfer" as const,
  projectId: recordId,
  vatAmount: "20",
  vendorName: "Örnek Teknoloji",
};

describe("spending validation", () => {
  it("normalizes card and expense money without a number conversion", () => {
    expect(
      createCreditCardInputSchema.parse({
        bankName: " Banka ",
        clientOperationKey: operationKey,
        creditLimitAmount: "900719925474099.1234",
        displayName: " İş kartı ",
        lastFour: "1234",
        note: "",
        paymentDueDay: 5,
        statementClosingDay: 25,
        status: "active",
      }),
    ).toMatchObject({
      bankName: "Banka",
      creditLimitAmount: "900719925474099.1234",
      displayName: "İş kartı",
      note: null,
    });
    expect(
      createExpenseInputSchema.parse({
        ...expense,
        clientOperationKey: operationKey,
      }),
    ).toMatchObject({ netAmount: "100.0000", vatAmount: "20.0000" });
  });

  it("requires card identity for card spending and rejects installments elsewhere", () => {
    expect(
      createExpenseInputSchema.safeParse({
        ...expense,
        clientOperationKey: operationKey,
        creditCardId: null,
        installmentCount: 3,
        paymentMethod: "credit_card",
      }).success,
    ).toBe(false);
    expect(
      createExpenseInputSchema.safeParse({
        ...expense,
        clientOperationKey: operationKey,
        installmentCount: 2,
      }).success,
    ).toBe(false);
  });

  it("requires a reason only when an expense is voided", () => {
    expect(
      updateExpenseInputSchema.safeParse({
        ...expense,
        status: "voided",
        version: 1,
        voidReason: "",
      }).success,
    ).toBe(false);
    expect(
      updateExpenseInputSchema.safeParse({
        ...expense,
        status: "voided",
        version: 1,
        voidReason: "Mükerrer kayıt",
      }).success,
    ).toBe(true);
  });

  it("keeps installment payment date consistent with status", () => {
    expect(
      updateCardInstallmentInputSchema.safeParse({
        paidOn: null,
        status: "paid",
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      updateCardInstallmentInputSchema.safeParse({
        paidOn: null,
        status: "planned",
        version: 1,
      }).success,
    ).toBe(true);
  });
});
