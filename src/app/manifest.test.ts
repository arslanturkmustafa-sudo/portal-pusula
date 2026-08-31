import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("declares a scoped standalone Turkish application", () => {
    const value = manifest();

    expect(value).toMatchObject({
      id: "/",
      name: "Portal Pusula",
      short_name: "Pusula",
      lang: "tr",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
        expect.objectContaining({ purpose: "maskable" }),
      ]),
    );
    expect(value.icons?.every((icon) => icon.src.startsWith("/"))).toBe(true);
  });
});

