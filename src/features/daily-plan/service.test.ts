// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  listDailyAgendaItems: vi.fn(),
  withUtcTransaction: vi.fn(),
}));

vi.mock("@/features/daily-plan/repository", () => ({
  listDailyAgendaItems: mocks.listDailyAgendaItems,
}));

vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: mocks.withUtcTransaction,
}));

import {
  dailyAgendaRange,
  getDailyAgenda,
  MAX_DAILY_PLAN_RANGE_DAYS,
} from "@/features/daily-plan/service";

const item = {
  committedOn: "2026-09-02",
  contractId: "20000000-0000-4000-8000-000000000001",
  customerCode: "ONCU",
  customerId: "10000000-0000-4000-8000-000000000001",
  customerName: "Öncü Üretim",
  internalDurationMinutes: 120,
  internalPlannedAtUtc: "2026-09-02 06:00:00.000000",
  resolutionStatus: "planned" as const,
  visitId: "30000000-0000-4000-8000-000000000001",
};

describe("daily agenda service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withUtcTransaction.mockImplementation(
      async (_pool: unknown, operation: (connection: object) => unknown) =>
        operation({}),
    );
    mocks.listDailyAgendaItems.mockResolvedValue([item]);
  });

  it("returns the validated daily range with repository items in one UTC transaction", async () => {
    const pool = {} as Pool;

    await expect(getDailyAgenda(pool, "2026-09-02")).resolves.toEqual({
      date: "2026-09-02",
      items: [item],
      range: { endDate: "2026-09-02", startDate: "2026-09-02" },
      view: "day",
    });
    expect(mocks.withUtcTransaction).toHaveBeenCalledWith(
      pool,
      expect.any(Function),
    );
    expect(mocks.listDailyAgendaItems).toHaveBeenCalledWith(
      expect.anything(),
      "2026-09-02",
      "2026-09-02",
    );
  });

  it("uses Monday through Sunday for a weekly view", async () => {
    await expect(
      getDailyAgenda({} as Pool, "2026-09-02", "week"),
    ).resolves.toMatchObject({
      range: { endDate: "2026-09-06", startDate: "2026-08-31" },
      view: "week",
    });
    expect(mocks.listDailyAgendaItems).toHaveBeenCalledWith(
      expect.anything(),
      "2026-08-31",
      "2026-09-06",
    );
  });

  it("uses the full calendar month within the maximum query range", () => {
    expect(dailyAgendaRange("2028-02-29", "month")).toEqual({
      date: "2028-02-29",
      range: { endDate: "2028-02-29", startDate: "2028-02-01" },
      view: "month",
    });
    expect(MAX_DAILY_PLAN_RANGE_DAYS).toBe(31);
  });

  it("keeps boundary weeks inside supported ISO dates", () => {
    expect(dailyAgendaRange("1000-01-01", "week").range.startDate).toBe(
      "1000-01-01",
    );
    expect(dailyAgendaRange("9999-12-31", "week").range.endDate).toBe(
      "9999-12-31",
    );
  });

  it("rejects an impossible date before opening a database transaction", async () => {
    await expect(getDailyAgenda({} as Pool, "2026-02-30")).rejects.toMatchObject({
      name: "ZodError",
    });
    expect(mocks.withUtcTransaction).not.toHaveBeenCalled();
    expect(mocks.listDailyAgendaItems).not.toHaveBeenCalled();
  });

  it("rejects an unsupported view before opening a database transaction", async () => {
    await expect(
      getDailyAgenda({} as Pool, "2026-09-02", "quarter"),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(mocks.withUtcTransaction).not.toHaveBeenCalled();
  });
});
