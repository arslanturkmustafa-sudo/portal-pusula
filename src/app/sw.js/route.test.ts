import { describe, expect, it } from "vitest";

import { GET } from "@/app/sw.js/route";

describe("service worker route", () => {
  it("serves the worker through Node with explicit safe headers", async () => {
    const response = GET();
    const source = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toMatch(/javascript/i);
    expect(response.headers.get("service-worker-allowed")).toBe("/");
    expect(source).toContain("portal-pusula-static-");
    expect(source).not.toContain("localStorage");
  });
});
