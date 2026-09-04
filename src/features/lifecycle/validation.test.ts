import { describe, expect, it } from "vitest";

import { lifecycleCommandInputSchema } from "./validation";

describe("lifecycleCommandInputSchema", () => {
  it("requires and canonicalizes an archive reason", () => {
    expect(
      lifecycleCommandInputSchema.parse({
        action: "archive",
        reason: "  Çalışma sona erdi  ",
        version: 3,
      }),
    ).toEqual({
      action: "archive",
      reason: "Çalışma sona erdi",
      version: 3,
    });
    expect(() =>
      lifecycleCommandInputSchema.parse({ action: "archive", version: 3 }),
    ).toThrow();
  });

  it("allows restore without a reason and rejects unknown keys", () => {
    expect(
      lifecycleCommandInputSchema.parse({ action: "restore", version: 7 }),
    ).toEqual({ action: "restore", version: 7 });
    expect(() =>
      lifecycleCommandInputSchema.parse({
        action: "restore",
        unexpected: true,
        version: 7,
      }),
    ).toThrow();
  });
});
