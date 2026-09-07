import { describe, expect, it } from "vitest";

import { createExpenseCategoryInputSchema } from "./expense-category-validation";

const operationKey = "30000000-0000-4000-8000-000000000001";

describe("expense category validation", () => {
  it("trims a user-defined category name", () => {
    expect(
      createExpenseCategoryInputSchema.parse({
        clientOperationKey: operationKey,
        displayName: "  Eğitim materyali  ",
      }),
    ).toEqual({
      clientOperationKey: operationKey,
      displayName: "Eğitim materyali",
    });
  });

  it("rejects unknown fields, empty names and non-canonical operation keys", () => {
    expect(() =>
      createExpenseCategoryInputSchema.parse({
        clientOperationKey: operationKey,
        displayName: "   ",
      }),
    ).toThrow();
    expect(() =>
      createExpenseCategoryInputSchema.parse({
        clientOperationKey: "not-a-uuid",
        displayName: "Eğitim",
      }),
    ).toThrow();
    expect(() =>
      createExpenseCategoryInputSchema.parse({
        clientOperationKey: operationKey,
        code: "caller_controlled_code",
        displayName: "Eğitim",
      }),
    ).toThrow();
  });
});
