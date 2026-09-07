// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }),
  view: z.enum(["day", "week", "month"]).default("day"),
});

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  getDailyAgenda: vi.fn(),
  parseQuery: vi.fn(),
  pool: {},
}));

vi.mock("@/features/daily-plan", () => ({
  dailyPlanQuerySchema: { parse: mocks.parseQuery },
  getDailyAgenda: mocks.getDailyAgenda,
}));

vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
}));

vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: vi.fn(() => ({})),
}));

vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: vi.fn(() => mocks.pool),
}));

import { GET } from "@/app/api/daily-plan/route";

const agenda = {
  date: "2026-09-02",
  items: [
    {
      committedOn: "2026-09-02",
      contractId: "20000000-0000-4000-8000-000000000001",
      customerCode: "ONCU",
      customerId: "10000000-0000-4000-8000-000000000001",
      customerName: "Öncü Üretim",
      internalDurationMinutes: 120,
      internalPlannedAtUtc: "2026-09-02 06:00:00.000000",
      resolutionStatus: "planned",
      visitId: "30000000-0000-4000-8000-000000000001",
    },
  ],
  range: { endDate: "2026-09-02", startDate: "2026-09-02" },
  tasks: [
    {
      calendarOn: "2026-09-02",
      calendarSource: "visit",
      customerName: "Öncü Üretim",
      dueOn: "2026-09-05",
      id: "40000000-0000-4000-8000-000000000001",
      linkedVisitId: "30000000-0000-4000-8000-000000000001",
      projectName: "Dönüşüm Programı",
      status: "todo",
      title: "Saha gözlemlerini hazırla",
    },
  ],
  view: "day",
};

function request(query = "?date=2026-09-02"): NextRequest {
  return new NextRequest(`https://portal.example.test/api/daily-plan${query}`);
}

describe("daily plan API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue({
      permissions: ["daily-plan.read", "tasks.read"],
      role: "member",
    });
    mocks.parseQuery.mockImplementation((value: unknown) =>
      querySchema.parse(value),
    );
    mocks.getDailyAgenda.mockResolvedValue(agenda);
  });

  it("returns the authenticated daily agenda without caching", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(agenda);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getDailyAgenda).toHaveBeenCalledWith(
      mocks.pool,
      "2026-09-02",
      "day",
      true,
    );
  });

  it("accepts one supported range view", async () => {
    mocks.getDailyAgenda.mockResolvedValue({
      ...agenda,
      range: { endDate: "2026-09-06", startDate: "2026-08-31" },
      view: "week",
    });

    const response = await GET(request("?date=2026-09-02&view=week"));

    expect(response.status).toBe(200);
    expect(mocks.getDailyAgenda).toHaveBeenCalledWith(
      mocks.pool,
      "2026-09-02",
      "week",
      true,
    );
  });

  it("returns an empty task projection to a daily-plan-only member", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      permissions: ["daily-plan.read"],
      role: "member",
    });
    mocks.getDailyAgenda.mockResolvedValue({ ...agenda, tasks: [] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tasks: [] });
    expect(mocks.getDailyAgenda).toHaveBeenCalledWith(
      mocks.pool,
      "2026-09-02",
      "day",
      false,
    );
  });

  it("rejects an unauthenticated request before validation or database access", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ status: "unauthorized" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.parseQuery).not.toHaveBeenCalled();
    expect(mocks.getDailyAgenda).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "?date=2026-02-30",
    "?date=2026-9-2",
    "?date=2026-09-02&view=year",
  ])(
    "maps a missing or invalid date to a generic validation error: %s",
    async (query) => {
      const response = await GET(request(query));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        status: "validation_error",
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(mocks.getDailyAgenda).not.toHaveBeenCalled();
    },
  );

  it.each([
    "?date=2026-09-02&extra=value",
    "?date=2026-09-02&date=2026-09-03",
    "?date=2026-09-02&view=week&view=month",
  ])("rejects an ambiguous query shape: %s", async (query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "validation_error",
    });
    expect(mocks.parseQuery).not.toHaveBeenCalled();
    expect(mocks.getDailyAgenda).not.toHaveBeenCalled();
  });

  it("does not disclose database errors", async () => {
    mocks.getDailyAgenda.mockRejectedValue({
      message: "database-message-sentinel",
      sql: "database-sql-sentinel",
    });

    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "service_unavailable" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).not.toContain("database-message-sentinel");
    expect(body).not.toContain("database-sql-sentinel");
  });
});
