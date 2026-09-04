import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  query: "customerId=customer-1&status=cancelled",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

import { TaskReportWorkspace } from "./task-report-workspace";

afterEach(() => {
  navigation.query = "customerId=customer-1&status=cancelled";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const customer = {
  displayName: "Atlas Makina",
  id: "customer-1",
  shortCode: "ATLAS",
  status: "active",
} as const;

describe("TaskReportWorkspace", () => {
  it("renders cancelled as a terminal report status and filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input) === "/api/customers") {
          return new Response(JSON.stringify({ customers: [customer] }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response(JSON.stringify({
          report: {
            customer,
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
        });
      }),
    );

    render(<TaskReportWorkspace />);

    expect(await screen.findByText("Eski kapsamı kapat")).toBeInTheDocument();
    expect(screen.getAllByText("İptal")).not.toHaveLength(0);
    expect(screen.getByRole("option", { name: "İptal" })).toHaveValue("cancelled");
    expect(screen.getByRole("combobox", { name: "Firma" })).toHaveValue("customer-1");
  });

  it("offers an understandable company picker without requiring a task-board filter", async () => {
    navigation.query = "";
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ customers: [customer] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TaskReportWorkspace />);

    expect(screen.getByRole("heading", { name: "Firma görev raporu" }))
      .toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Atlas Makina · ATLAS" }))
      .toHaveValue("customer-1");
    expect(screen.getByRole("combobox", { name: "Firma" })).toBeRequired();
    const submit = screen.getByRole("button", { name: "Raporu aç" });
    expect(submit.closest("form")?.getAttribute("action")).toBe("/gorevler/rapor");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
