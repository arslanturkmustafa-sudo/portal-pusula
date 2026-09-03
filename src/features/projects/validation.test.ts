import { describe, expect, it } from "vitest";

import {
  createProjectInputSchema,
  updateProjectInputSchema,
} from "@/features/projects/validation";

describe("project input", () => {
  it("normalizes a complete project document", () => {
    expect(
      createProjectInputSchema.parse({
        budgetAmount: "60000",
        displayName: "  ByPusula  ",
        objective: "  İşletme olgunluğunu değerlendirmek  ",
        projectType: "product",
        shortCode: "  bypusula  ",
      }),
    ).toEqual({
      budgetAmount: "60000.0000",
      displayName: "ByPusula",
      internalNote: null,
      objective: "İşletme olgunluğunu değerlendirmek",
      projectType: "product",
      shortCode: "BYPUSULA",
      startsOn: null,
      status: "active",
      targetEndsOn: null,
    });
  });

  it("rejects a reversed project period", () => {
    expect(() =>
      createProjectInputSchema.parse({
        displayName: "OptiPusula",
        projectType: "product",
        shortCode: "OPTIPUSULA",
        startsOn: "2026-12-01",
        targetEndsOn: "2026-01-01",
      }),
    ).toThrow();
  });

  it("requires a complete versioned document for updates", () => {
    expect(() =>
      updateProjectInputSchema.parse({
        displayName: "Mühendis Kafası",
        version: 2,
      }),
    ).toThrow();
  });
});
