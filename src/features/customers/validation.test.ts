import { describe, expect, it } from "vitest";

import {
  createCustomerInputSchema,
  updateCustomerInputSchema,
} from "@/features/customers/validation";

describe("customer input", () => {
  it("preserves Turkish text and canonicalizes safe identifiers", () => {
    expect(
      createCustomerInputSchema.parse({
        contactNote: "  Çağdaş üretim ekibi  ",
        displayName: "  Örnek Mühendislik A.Ş.  ",
        email: "  ILETISIM@EXAMPLE.COM ",
        phone: "",
        shortCode: " mk_006 ",
      }),
    ).toEqual({
      contactNote: "Çağdaş üretim ekibi",
      displayName: "Örnek Mühendislik A.Ş.",
      email: "iletisim@example.com",
      phone: null,
      shortCode: "MK_006",
      status: "active",
    });
  });

  it("rejects invalid codes and empty updates", () => {
    expect(() =>
      createCustomerInputSchema.parse({
        displayName: "Örnek",
        shortCode: "geçersiz kod",
      }),
    ).toThrow();
    expect(() => updateCustomerInputSchema.parse({})).toThrow();
  });
});
