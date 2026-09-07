// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  getDailyAgenda: vi.fn(),
  logError: vi.fn(),
  pool: {},
}));

vi.mock("@/features/daily-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/daily-plan")>();
  return { ...actual, getDailyAgenda: mocks.getDailyAgenda };
});

vi.mock("@/platform/auth/server-auth", () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
}));

vi.mock("@/platform/config/readiness-env", () => ({
  getDatabaseProbeEnvironment: vi.fn(() => ({})),
}));

vi.mock("@/platform/database/mysql-platform", () => ({
  getPlatformDatabasePool: vi.fn(() => mocks.pool),
}));

vi.mock("@/platform/logging/logger", () => ({
  requestLogger: vi.fn(() => ({ error: mocks.logError })),
}));

import { GET } from "@/app/api/daily-plan/export/route";

const correlationId = "70000000-0000-4000-8000-000000000001";
const customerId = "10000000-0000-4000-8000-000000000001";
const agenda = {
  customers: [
    { code: "ATLAS", id: customerId, name: "Atlas Makina" },
  ],
  date: "2026-09-02",
  items: [
    {
      committedOn: "2026-09-02",
      contractId: "20000000-0000-4000-8000-000000000001",
      customerCode: "ATLAS",
      customerId,
      customerName: "Atlas Makina",
      internalDurationMinutes: null,
      internalPlannedAtUtc: null,
      locationLabel: "Merkez ofis",
      resolutionStatus: "planned",
      visitId: "30000000-0000-4000-8000-000000000001",
    },
  ],
  range: { endDate: "2026-09-02", startDate: "2026-09-02" },
  tasks: [],
  view: "day",
} as const;

function request(query: string): NextRequest {
  return new NextRequest(
    `https://portal.example.test/api/daily-plan/export${query}`,
    { headers: { "x-correlation-id": correlationId } },
  );
}

describe("daily plan customer export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdminRequest.mockResolvedValue({
      permissions: ["daily-plan.read", "tasks.read"],
      role: "member",
    });
    mocks.getDailyAgenda.mockResolvedValue(agenda);
  });

  it("returns a no-store customer-bound ICS download", async () => {
    const response = await GET(
      request(`?customerId=${customerId}&date=2026-09-02&view=day&format=ics`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
    expect(mocks.getDailyAgenda).toHaveBeenCalledWith(
      mocks.pool,
      "2026-09-02",
      "day",
      false,
      customerId,
    );
  });

  it("exports only the selected location in authenticated ICS and print output", async () => {
    const otherLocation = "Gizli şube";
    mocks.getDailyAgenda.mockResolvedValue({
      ...agenda,
      items: [
        agenda.items[0],
        {
          ...agenda.items[0],
          locationLabel: otherLocation,
          visitId: "30000000-0000-4000-8000-000000000002",
        },
      ],
    });

    for (const format of ["ics", "print"] as const) {
      const response = await GET(
        request(
          `?customerId=${customerId}&date=2026-09-02&view=day&location=${encodeURIComponent("Merkez ofis")}&format=${format}`,
        ),
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(body).toContain("Merkez ofis");
      expect(body).not.toContain(otherLocation);
      if (format === "ics") {
        expect(body.match(/BEGIN:VEVENT/gu)).toHaveLength(1);
      } else {
        expect(response.headers.get("content-security-policy")).toContain(
          "default-src 'none'",
        );
      }
    }
    expect(mocks.getDailyAgenda).toHaveBeenCalledTimes(2);
    expect(mocks.getDailyAgenda).toHaveBeenNthCalledWith(
      2,
      mocks.pool,
      "2026-09-02",
      "day",
      false,
      customerId,
    );
  });

  it("returns a CSP-restricted printable view without querying internal tasks", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      permissions: ["daily-plan.read"],
      role: "member",
    });

    const response = await GET(
      request(`?customerId=${customerId}&date=2026-09-02&format=print`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toContain("Atlas Makina");
    expect(mocks.getDailyAgenda).toHaveBeenCalledWith(
      mocks.pool,
      "2026-09-02",
      "day",
      false,
      customerId,
    );
  });

  it("rejects unauthenticated and ambiguous requests before database access", async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce(null);
    const unauthorized = await GET(
      request(`?customerId=${customerId}&date=2026-09-02&format=ics`),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.getDailyAgenda).not.toHaveBeenCalled();

    mocks.authenticateAdminRequest.mockResolvedValue({
      permissions: ["daily-plan.read"],
      role: "member",
    });
    const invalidQueries = [
      `?customerId=${customerId}&customerId=10000000-0000-4000-8000-000000000002&date=2026-09-02&format=ics`,
      `?customerId=${customerId}&date=2026-09-02&location=Merkez&location=Sube&format=ics`,
      `?customerId=${customerId}&date=2026-09-02&unknown=value&format=ics`,
      `?customerId=${customerId}&date=2026-09-02&location=${"x".repeat(192)}&format=ics`,
    ];
    for (const query of invalidQueries) {
      const invalid = await GET(request(query));
      expect(invalid.status, query).toBe(400);
      await expect(invalid.json()).resolves.toEqual({
        status: "validation_error",
      });
    }
    expect(mocks.getDailyAgenda).not.toHaveBeenCalled();
  });

  it("does not disclose a cross-customer projection or failure details", async () => {
    mocks.getDailyAgenda.mockResolvedValue({
      ...agenda,
      items: [
        {
          ...agenda.items[0],
          customerId: "10000000-0000-4000-8000-000000000002",
          customerName: "Gizli müşteri",
        },
      ],
    });

    const response = await GET(
      request(`?customerId=${customerId}&date=2026-09-02&format=ics`),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("Gizli müşteri");
    expect(body).not.toContain("Calendar customer scope");
    expect(mocks.logError).toHaveBeenCalledWith(
      {
        event: "daily_plan.export_failed",
        pathname: "/api/daily-plan/export",
      },
      "Daily plan export failed.",
    );
  });
});
