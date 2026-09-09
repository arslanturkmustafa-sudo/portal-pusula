// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  emailNotificationsEnabled: vi.fn(),
  enqueueEmailDelivery: vi.fn(),
  listActiveOwnerEmailRecipients: vi.fn(),
  listDailyAgendaItems: vi.fn(),
  listDailyPlanTasks: vi.fn(),
  withUtcTransaction: vi.fn(),
}));

vi.mock("@/features/account/repository", () => ({
  listActiveOwnerEmailRecipients: mocks.listActiveOwnerEmailRecipients,
}));

vi.mock("@/features/daily-plan", () => ({
  listDailyAgendaItems: mocks.listDailyAgendaItems,
  listDailyPlanTasks: mocks.listDailyPlanTasks,
}));

vi.mock("@/platform/config/email-env", () => ({
  emailNotificationsEnabled: mocks.emailNotificationsEnabled,
}));

vi.mock("@/platform/email/outbox-email", () => ({
  enqueueEmailDelivery: mocks.enqueueEmailDelivery,
}));

vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: mocks.withUtcTransaction,
}));

import {
  enqueueDailyDigestEmailsIfDue,
  istanbulDigestWindow,
} from "./daily-digest";

const ownerOne = {
  displayName: "Mustafa Arslan",
  email: "owner-one@example.test",
  id: "10000000-0000-4000-8000-000000000001",
};
const ownerTwo = {
  displayName: "İkinci Yönetici",
  email: "owner-two@example.test",
  id: "10000000-0000-4000-8000-000000000002",
};

const plannedVisit = {
  committedOn: "2026-09-10",
  contractId: "20000000-0000-4000-8000-000000000001",
  customerCode: "ATLAS",
  customerId: "30000000-0000-4000-8000-000000000001",
  customerName: "Atlas <Üretim>",
  deliveredOn: null,
  internalDurationMinutes: 90,
  internalPlannedAtUtc: "2026-09-10 06:30:00.000000",
  locationLabel: "Merkez",
  resolutionNote: null,
  resolutionStatus: "planned" as const,
  visitId: "40000000-0000-4000-8000-000000000001",
};

const makeupVisit = {
  ...plannedVisit,
  resolutionStatus: "makeup_pending" as const,
  visitId: "40000000-0000-4000-8000-000000000002",
};

const completedVisit = {
  ...plannedVisit,
  deliveredOn: "2026-09-10",
  resolutionStatus: "completed" as const,
  visitId: "40000000-0000-4000-8000-000000000003",
};

const openTask = {
  calendarOn: "2026-09-10",
  calendarSource: "visit" as const,
  customerId: plannedVisit.customerId,
  customerName: "Atlas <Üretim>",
  dueOn: "2026-09-12",
  id: "50000000-0000-4000-8000-000000000001",
  linkedVisitId: plannedVisit.visitId,
  locationLabel: "Merkez",
  projectName: "Dönüşüm",
  status: "todo" as const,
  title: "Risk <script>alert(1)</script> kontrolü",
};

const doneTask = {
  ...openTask,
  id: "50000000-0000-4000-8000-000000000002",
  status: "done" as const,
};

describe("daily digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emailNotificationsEnabled.mockReturnValue(true);
    mocks.listActiveOwnerEmailRecipients.mockResolvedValue([
      ownerOne,
      ownerTwo,
    ]);
    mocks.listDailyAgendaItems.mockResolvedValue([
      plannedVisit,
      makeupVisit,
      completedVisit,
    ]);
    mocks.listDailyPlanTasks.mockResolvedValue([openTask, doneTask]);
    mocks.enqueueEmailDelivery.mockResolvedValue(undefined);
    mocks.withUtcTransaction.mockImplementation(
      async (_pool: unknown, operation: (connection: object) => unknown) =>
        operation({}),
    );
  });

  it("opens at 09:00 Europe/Istanbul and preserves the Istanbul business date", () => {
    expect(istanbulDigestWindow(new Date("2026-09-10T05:59:59.999Z"))).toEqual({
      businessDate: "2026-09-10",
      due: false,
      hour: 8,
    });
    expect(istanbulDigestWindow(new Date("2026-09-10T06:00:00.000Z"))).toEqual({
      businessDate: "2026-09-10",
      due: true,
      hour: 9,
    });
    expect(istanbulDigestWindow(new Date("2026-09-10T21:30:00.000Z"))).toEqual({
      businessDate: "2026-09-11",
      due: false,
      hour: 0,
    });
  });

  it("enqueues one stable delivery per active owner with only open daily work", async () => {
    await expect(
      enqueueDailyDigestEmailsIfDue(
        {} as Pool,
        new Date("2026-09-10T06:00:00.000Z"),
      ),
    ).resolves.toEqual({
      businessDate: "2026-09-10",
      deliveryCount: 2,
      status: "enqueued",
    });

    expect(mocks.listDailyAgendaItems).toHaveBeenCalledWith(
      expect.anything(),
      "2026-09-10",
      "2026-09-10",
    );
    expect(mocks.listDailyPlanTasks).toHaveBeenCalledWith(
      expect.anything(),
      "2026-09-10",
      "2026-09-10",
    );
    expect(mocks.enqueueEmailDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueEmailDelivery).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        idempotencyKey:
          "daily-digest:2026-09-10:10000000-0000-4000-8000-000000000001",
        recipientAccountId: ownerOne.id,
      }),
    );
    expect(mocks.enqueueEmailDelivery).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        idempotencyKey:
          "daily-digest:2026-09-10:10000000-0000-4000-8000-000000000002",
        recipientAccountId: ownerTwo.id,
      }),
    );

    const firstMessage = mocks.enqueueEmailDelivery.mock.calls[0]?.[1]?.message;
    expect(firstMessage.text).toContain("Ziyaretler (2)");
    expect(firstMessage.text).toContain("Yapılacak görevler (1)");
    expect(firstMessage.text).not.toContain("completed");
    expect(firstMessage.html).toContain("Atlas &lt;Üretim&gt;");
    expect(firstMessage.html).not.toContain("<script>");
  });

  it("does not create a delivery before the window, while disabled, or for an empty day", async () => {
    await expect(
      enqueueDailyDigestEmailsIfDue(
        {} as Pool,
        new Date("2026-09-10T05:59:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: "before_window" });
    expect(mocks.withUtcTransaction).not.toHaveBeenCalled();

    mocks.emailNotificationsEnabled.mockReturnValue(false);
    await expect(
      enqueueDailyDigestEmailsIfDue(
        {} as Pool,
        new Date("2026-09-10T06:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: "disabled" });
    expect(mocks.withUtcTransaction).not.toHaveBeenCalled();

    mocks.emailNotificationsEnabled.mockReturnValue(true);
    mocks.listDailyAgendaItems.mockResolvedValue([completedVisit]);
    mocks.listDailyPlanTasks.mockResolvedValue([doneTask]);
    await expect(
      enqueueDailyDigestEmailsIfDue(
        {} as Pool,
        new Date("2026-09-10T06:00:00.000Z"),
      ),
    ).resolves.toEqual({
      businessDate: "2026-09-10",
      deliveryCount: 0,
      status: "empty",
    });
    expect(mocks.listActiveOwnerEmailRecipients).not.toHaveBeenCalled();
    expect(mocks.enqueueEmailDelivery).not.toHaveBeenCalled();
  });
});
