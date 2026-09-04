// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeCustomerTaskReport,
  TaskReportTooLargeError,
} from "@/features/task-reports/service";

const customer = {
  displayName: "Öncü Üretim",
  id: "10000000-0000-4000-8000-000000000001",
  shortCode: "ONCU",
  status: "active" as const,
};
const filter = { customerId: customer.id, status: "all" as const };

describe("customer task report composition", () => {
  it("counts open, completed and Istanbul-local overdue tasks", () => {
    const report = composeCustomerTaskReport(
      customer,
      filter,
      [
        {
          assigneeDisplayName: null,
          completedAtUtc: null,
          description: null,
          dueOn: "2026-09-02",
          id: "1",
          priority: "normal",
          projectCode: null,
          projectName: null,
          status: "todo",
          title: "Geciken görev",
        },
        {
          assigneeDisplayName: null,
          completedAtUtc: "2026-09-02 09:00:00.000000",
          description: null,
          dueOn: "2026-09-01",
          id: "2",
          priority: "high",
          projectCode: null,
          projectName: null,
          status: "done",
          title: "Tamamlanan görev",
        },
        {
          assigneeDisplayName: null,
          completedAtUtc: null,
          description: null,
          dueOn: "2026-09-01",
          id: "3",
          priority: "normal",
          projectCode: null,
          projectName: null,
          status: "cancelled",
          title: "İptal edilen görev",
        },
      ],
      new Date("2026-09-03T08:00:00.000Z"),
    );
    expect(report.generatedOn).toBe("2026-09-03");
    expect(report.summary).toEqual({ completed: 1, open: 1, overdue: 1, total: 3 });
  });

  it("fails instead of silently truncating over 1000 records", () => {
    const item = {
      assigneeDisplayName: null,
      completedAtUtc: null,
      description: null,
      dueOn: null,
      id: "task",
      priority: "normal" as const,
      projectCode: null,
      projectName: null,
      status: "todo" as const,
      title: "Görev",
    };
    expect(() =>
      composeCustomerTaskReport(
        customer,
        filter,
        Array.from({ length: 1_001 }, (_, index) => ({ ...item, id: String(index) })),
        new Date(),
      ),
    ).toThrow(TaskReportTooLargeError);
  });
});
