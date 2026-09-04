import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("customerId=customer-1&status=cancelled"),
}));

import { TaskReportWorkspace } from "./task-report-workspace";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TaskReportWorkspace", () => {
  it("renders cancelled as a terminal report status and filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({
          report: {
            customer: {
              displayName: "Atlas Makina",
              id: "customer-1",
              shortCode: "ATLAS",
              status: "active",
            },
            filter: { customerId: "customer-1", status: "cancelled" },
            generatedAtUtc: "2026-09-04T08:00:00.000Z",
            generatedOn: "2026-09-04",
            summary: { completed: 0, open: 0, overdue: 0, total: 1 },
            tasks: [{
              assigneeDisplayName: null,
              completedAtUtc: null,
              description: "Müşteri kararıyla kapatıldı",
              dueOn: "2026-09-03",
              id: "task-1",
              priority: "normal",
              projectCode: "PP",
              projectName: "Portal Pusula",
              status: "cancelled",
              title: "Eski kapsamı kapat",
            }],
          },
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );

    render(<TaskReportWorkspace />);

    expect(await screen.findByText("Eski kapsamı kapat")).toBeInTheDocument();
    expect(screen.getAllByText("İptal")).not.toHaveLength(0);
    expect(screen.getByRole("option", { name: "İptal" })).toHaveValue("cancelled");
  });
});
