import { describe, expect, it } from "vitest";

import {
  createCustomerInputSchema,
  updateCustomerInputSchema,
} from "@/features/customers/validation";

describe("customer input", () => {
  const projectId = "10000000-0000-4000-8000-00000000abcd";

  it("preserves Turkish text and canonicalizes safe identifiers", () => {
    expect(
      createCustomerInputSchema.parse({
        contactNote: "  Çağdaş üretim ekibi  ",
        displayName: "  Örnek Mühendislik A.Ş.  ",
        email: "  ILETISIM@EXAMPLE.COM ",
        phone: "",
        projectIds: [projectId],
        shortCode: " mk_006 ",
      }),
    ).toEqual({
      contactNote: "Çağdaş üretim ekibi",
      displayName: "Örnek Mühendislik A.Ş.",
      email: "iletisim@example.com",
      phone: null,
      projectIds: [projectId],
      shortCode: "MK_006",
      status: "active",
    });
  });

  it("rejects invalid codes and empty updates", () => {
    expect(() =>
      createCustomerInputSchema.parse({
        displayName: "Örnek",
        projectIds: [projectId],
        shortCode: "geçersiz kod",
      }),
    ).toThrow();
    expect(() => updateCustomerInputSchema.parse({})).toThrow();
  });

  it("requires a non-empty, unique canonical project set", () => {
    const base = { displayName: "Örnek", shortCode: "ORNEK" };
    expect(() => createCustomerInputSchema.parse(base)).toThrow();
    expect(() =>
      createCustomerInputSchema.parse({ ...base, projectIds: [] }),
    ).toThrow();
    expect(() =>
      createCustomerInputSchema.parse({
        ...base,
        projectIds: [projectId, projectId],
      }),
    ).toThrow();
    expect(() =>
      updateCustomerInputSchema.parse({ projectIds: [projectId.toUpperCase()] }),
    ).toThrow();
  });
});
