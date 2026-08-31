import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/live/route";
import { isCorrelationId } from "@/platform/http/correlation-id";

describe("public liveness route", () => {
  it("returns only minimal health information without caching", async () => {
    const response = GET(new Request("http://localhost/api/health/live"));

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(isCorrelationId(response.headers.get("x-correlation-id"))).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/database|version|node|uptime|hostname/i);
  });
});
