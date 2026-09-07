import { describe, expect, it } from "vitest";

import { developmentAuthenticationBypassAllowed } from "@/platform/auth/development-bypass";

const allowedEnvironment = {
  NODE_ENV: "development",
  PORTAL_PUSULA_ALLOW_DEV_AUTH_BYPASS: "true",
};

describe("development authentication bypass", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("allows explicit loopback host %s", (host) => {
    expect(developmentAuthenticationBypassAllowed(host, allowedEnvironment)).toBe(true);
  });

  it("stays closed without opt-in, on LAN hosts, in production, or with auth configured", () => {
    expect(developmentAuthenticationBypassAllowed("localhost", { NODE_ENV: "development" })).toBe(false);
    expect(developmentAuthenticationBypassAllowed("192.168.1.20", allowedEnvironment)).toBe(false);
    expect(developmentAuthenticationBypassAllowed("localhost", { ...allowedEnvironment, NODE_ENV: "production" })).toBe(false);
    expect(developmentAuthenticationBypassAllowed("localhost", { ...allowedEnvironment, SESSION_SECRET: "configured" })).toBe(false);
  });
});
