import { describe, expect, it } from "vitest";

import {
  createFinanceAccountInputSchema,
  createFinanceTransactionInputSchema,
  reverseFinanceTransactionInputSchema,
  updateFinanceAccountInputSchema,
} from "./account-validation";

const firstAccountId = "10000000-0000-4000-8000-000000000001";
const secondAccountId = "20000000-0000-4000-8000-000000000001";
const operationKey = "30000000-0000-4000-8000-000000000001";

describe("finance account validation", () => {
  it("normalizes a bank account and signed opening balance", () => {
    expect(
      createFinanceAccountInputSchema.parse({
        accountType: "bank",
        bankName: "  Pusula Bankası  ",
        clientOperationKey: operationKey,
        displayName: "  İşletme hesabı  ",
        openingBalanceAmount: "-125.5",
      }),
    ).toEqual({
      accountType: "bank",
      bankName: "Pusula Bankası",
      clientOperationKey: operationKey,
      displayName: "İşletme hesabı",
      openingBalanceAmount: "-125.5000",
      status: "active",
    });
  });

  it("rejects a bank name on cash and immutable update fields", () => {
    expect(() =>
      createFinanceAccountInputSchema.parse({
        accountType: "cash",
        bankName: "Banka",
        clientOperationKey: operationKey,
        displayName: "Merkez kasa",
        openingBalanceAmount: "0",
      }),
    ).toThrow();
    expect(() =>
      updateFinanceAccountInputSchema.parse({
        accountType: "bank",
        bankName: null,
        currency: "USD",
        displayName: "Banka",
        status: "active",
        version: 1,
      }),
    ).toThrow();
  });
});

describe("finance transaction validation", () => {
  it.each([
    ["income", null, firstAccountId],
    ["expense", firstAccountId, null],
    ["transfer", firstAccountId, secondAccountId],
  ] as const)("accepts the %s account shape", (transactionType, sourceAccountId, targetAccountId) => {
    expect(
      createFinanceTransactionInputSchema.parse({
        amount: "1250.5",
        clientOperationKey: operationKey,
        description: "Hesap hareketi",
        occurredOn: "2026-09-07",
        sourceAccountId,
        targetAccountId,
        transactionType,
      }),
    ).toMatchObject({ amount: "1250.5000", transactionType });
  });

  it("rejects same-account transfers, wrong legs, invalid dates and non-positive money", () => {
    const base = {
      amount: "100",
      clientOperationKey: operationKey,
      description: "Virman",
      occurredOn: "2026-09-07",
      sourceAccountId: firstAccountId,
      targetAccountId: firstAccountId,
      transactionType: "transfer",
    };
    expect(() => createFinanceTransactionInputSchema.parse(base)).toThrow();
    expect(() =>
      createFinanceTransactionInputSchema.parse({
        ...base,
        amount: "0",
        occurredOn: "2026-02-30",
        targetAccountId: secondAccountId,
      }),
    ).toThrow();
  });

  it("bounds and trims reversal reasons", () => {
    expect(
      reverseFinanceTransactionInputSchema.parse({
        clientOperationKey: operationKey,
        reason: "  Yanlış hesap seçildi  ",
      }),
    ).toEqual({
      clientOperationKey: operationKey,
      reason: "Yanlış hesap seçildi",
    });
    expect(() =>
      reverseFinanceTransactionInputSchema.parse({
        clientOperationKey: operationKey,
        reason: "x".repeat(2001),
      }),
    ).toThrow();
  });
});
