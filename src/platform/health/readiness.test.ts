import { describe, expect, it, vi } from "vitest";

import {
  createReadinessHandler,
  denyAllReadiness,
} from "@/platform/health/readiness";

describe("protected readiness boundary", () => {
  it("fails closed without running any readiness check", async () => {
    const check = vi.fn(() => true);
    const handler = createReadinessHandler({
      authorize: denyAllReadiness,
      check,
    });

    const response = await handler(
      new Request("http://localhost/api/internal/readiness"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "not_found" });
    expect(check).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("supports an injected authorized check", async () => {
    const handler = createReadinessHandler({
      authorize: () => true,
      check: () => true,
    });

    const response = await handler(
      new Request("http://localhost/api/internal/readiness"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("fails closed when authorization itself throws", async () => {
    const check = vi.fn(() => true);
    const handler = createReadinessHandler({
      authorize: () => {
        throw new Error("authorization-secret-must-not-leak");
      },
      check,
    });

    const response = await handler(
      new Request("http://localhost/api/internal/readiness"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "not_found" });
    expect(check).not.toHaveBeenCalled();
  });

  it("converts check failures into a generic unavailable response", async () => {
    const handler = createReadinessHandler({
      authorize: () => true,
      check: () => {
        throw new Error("database-and-secret-details-must-not-leak");
      },
    });

    const response = await handler(
      new Request("http://localhost/api/internal/readiness"),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"status":"unavailable"}');
    expect(body).not.toContain("database-and-secret");
  });
});
