// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getReport: vi.fn(),
}));
vi.mock("@/features/finance", async () => {
  const { z } = await import("zod");
  return {
    getProjectFinanceReport: mocks.getReport,
    projectFinanceReportFilterSchema: z.object({
      month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
    }).strict(),
  };
});
vi.mock("@/platform/auth/server-auth", () => ({ authenticateAdminRequest: mocks.authenticate }));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: () => ({}) }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: () => ({}) }));

import { GET } from "@/app/api/finance/project-summary/route";

describe("project finance summary API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ kind: "account" });
    mocks.getReport.mockResolvedValue({ month: "2026-09", projects: [] });
  });

  it("requires authentication", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await GET(new NextRequest("https://portal.example/api/finance/project-summary?month=2026-09"));
    expect(response.status).toBe(401);
    expect(mocks.getReport).not.toHaveBeenCalled();
  });

  it("returns the selected monthly report without caching", async () => {
    const response = await GET(new NextRequest("https://portal.example/api/finance/project-summary?month=2026-09"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getReport).toHaveBeenCalledWith({}, { month: "2026-09" });
  });

  it.each([
    "https://portal.example/api/finance/project-summary",
    "https://portal.example/api/finance/project-summary?month=2026-13",
    "https://portal.example/api/finance/project-summary?month=2026-09&month=2026-10",
    "https://portal.example/api/finance/project-summary?month=2026-09&extra=1",
  ])("rejects an invalid query: %s", async (url) => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
    expect(mocks.getReport).not.toHaveBeenCalled();
  });
});
