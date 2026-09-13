// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  listDailyAgendaItems: vi.fn(),
  listDailyPlanTasks: vi.fn(),
  listOpenFinanceDigestItems: vi.fn(),
}));

vi.mock("@/features/daily-plan", () => ({
  listDailyAgendaItems: mocks.listDailyAgendaItems,
  listDailyPlanTasks: mocks.listDailyPlanTasks,
}));

vi.mock("@/features/finance/finance-digest-repository", () => ({
  listOpenFinanceDigestItems: mocks.listOpenFinanceDigestItems,
}));

import { readTodayOverview } from "./service";

const plannedVisit = {
  committedOn: "2026-09-13",
  contractId: "contract-1",
  customerCode: "ATLAS",
  customerId: "customer-1",
  customerName: "Atlas Makina",
  deliveredOn: null,
  internalDurationMinutes: 90,
  internalPlannedAtUtc: "2026-09-13 06:30:00.000000",
  locationLabel: "Merkez",
  resolutionNote: null,
  resolutionStatus: "planned" as const,
  visitId: "visit-1",
};

const openTask = {
  calendarOn: "2026-09-13",
  calendarSource: "due_date" as const,
  customerId: null,
  customerName: null,
  dueOn: "2026-09-13",
  id: "task-1",
  linkedVisitId: null,
  locationLabel: null,
  projectName: null,
  status: "todo" as const,
  title: "Teklifi hazırla",
};

describe("today overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDailyAgendaItems.mockResolvedValue([
      plannedVisit,
      {
        ...plannedVisit,
        resolutionStatus: "completed",
        visitId: "visit-2",
      },
    ]);
    mocks.listDailyPlanTasks.mockResolvedValue([
      openTask,
      { ...openTask, id: "task-2", status: "done" },
    ]);
    mocks.listOpenFinanceDigestItems.mockResolvedValue([
      {
        direction: "inflow",
        dueOn: "2026-09-13",
        label: "Danışmanlık tahsilatı",
        remainingAmount: "1250.0000",
        sourceLabel: "Atlas Makina",
      },
    ]);
  });

  it("returns the same open work used by the morning digest", async () => {
    await expect(
      readTodayOverview({} as PoolConnection, "2026-09-13", {
        canReadFinance: true,
        canReadTasks: true,
        canReadVisits: true,
      }),
    ).resolves.toEqual({
      businessDate: "2026-09-13",
      financeItems: [
        expect.objectContaining({ label: "Danışmanlık tahsilatı" }),
      ],
      tasks: [openTask],
      visits: [plannedVisit],
    });
  });

  it("does not query or expose sections the principal cannot read", async () => {
    const overview = await readTodayOverview(
      {} as PoolConnection,
      "2026-09-13",
      {
        canReadFinance: false,
        canReadTasks: true,
        canReadVisits: false,
      },
    );

    expect(overview).toEqual({
      businessDate: "2026-09-13",
      financeItems: undefined,
      tasks: [openTask],
      visits: [],
    });
    expect(mocks.listDailyAgendaItems).not.toHaveBeenCalled();
    expect(mocks.listOpenFinanceDigestItems).not.toHaveBeenCalled();
  });
});
