import { describe, expect, it } from "vitest";

import {
  createCollectionInputSchema,
  generateReceivableInputSchema,
  openingBalanceInputSchema,
} from "@/features/finance/validation";

const id = "10000000-0000-4000-8000-000000000001";
const operationKey = "40000000-0000-4000-8000-000000000001";

describe("finance input validation", () => {
  it("normalizes every accepted API money value to four decimals", () => {
    expect(
      openingBalanceInputSchema.parse({
        clientOperationKey: operationKey,
        customerId: id,
        description: "Geçmiş dönem danışmanlık alacağı",
        dueOn: "2026-08-15",
        netAmount: "75000",
        vatAmount: "0",
      }),
    ).toMatchObject({ netAmount: "75000.0000", vatAmount: "0.0000" });
    expect(
      createCollectionInputSchema.parse({
        amount: "123.45",
        clientOperationKey: operationKey,
        collectedOn: "2026-09-01",
        note: "",
        receivableId: id,
      }),
    ).toMatchObject({ amount: "123.4500", note: null });
  });

  it("rejects invalid months, non-canonical ids, zero collections and excess precision", () => {
    expect(
      generateReceivableInputSchema.safeParse({
        contractId: id.toUpperCase(),
        month: "2026-13",
      }).success,
    ).toBe(false);
    expect(
      generateReceivableInputSchema.safeParse({
        contractId: id,
        month: "2026-00",
      }).success,
    ).toBe(false);
    expect(
      createCollectionInputSchema.safeParse({
        amount: "0",
        clientOperationKey: operationKey,
        collectedOn: "2026-09-01",
        note: null,
        receivableId: id,
      }).success,
    ).toBe(false);
    expect(
      openingBalanceInputSchema.safeParse({
        clientOperationKey: operationKey,
        customerId: id,
        description: "Alacak",
        dueOn: "2026-09-01",
        netAmount: "1.00001",
        vatAmount: "0",
      }).success,
    ).toBe(false);
  });

  it("rejects zero and overflowing opening balances", () => {
    expect(
      openingBalanceInputSchema.safeParse({
        clientOperationKey: operationKey,
        customerId: id,
        description: "Alacak",
        dueOn: "2026-09-01",
        netAmount: "0",
        vatAmount: "0",
      }).success,
    ).toBe(false);
    expect(
      openingBalanceInputSchema.safeParse({
        clientOperationKey: operationKey,
        customerId: id,
        description: "Alacak",
        dueOn: "2026-09-01",
        netAmount: "999999999999999.9999",
        vatAmount: "0.0001",
      }).success,
    ).toBe(false);
  });
});
