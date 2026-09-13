import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MyDayWorkspace } from "@/components/home/my-day-workspace";

afterEach(() => cleanup());

const overview = {
  businessDate: "2026-09-13",
  financeItems: [
    {
      direction: "inflow" as const,
      dueOn: "2026-09-12",
      label: "Danışmanlık tahsilatı",
      remainingAmount: "1250.0000",
      sourceLabel: "Atlas Makina",
    },
    {
      direction: "outflow" as const,
      dueOn: "2026-09-13",
      label: "KDV",
      remainingAmount: "800.0000",
      sourceLabel: "2026-08",
    },
  ],
  tasks: [
    {
      calendarOn: "2026-09-13",
      calendarSource: "visit" as const,
      customerId: "customer-1",
      customerName: "Atlas Makina",
      dueOn: "2026-09-14",
      id: "task-1",
      linkedVisitId: "visit-1",
      locationLabel: "Merkez",
      projectName: "Dönüşüm",
      status: "todo" as const,
      title: "Risk kontrolü",
    },
  ],
  visits: [
    {
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
    },
  ],
};

const fullCapabilities = {
  canCreateExpenses: true,
  canCreateTasks: true,
  canReadFinance: true,
  canReadPlanning: true,
  canReadTasks: true,
  canReadVisits: true,
};

describe("MyDayWorkspace", () => {
  it("shows the morning summary with quick links to each related workspace", () => {
    render(
      <MyDayWorkspace
        capabilities={fullCapabilities}
        overview={overview}
      />,
    );

    const actions = screen.getByRole("navigation", {
      name: "Günüm hızlı işlemleri",
    });
    expect(within(actions).getByRole("link", { name: /Planlamayı aç/u })).toHaveAttribute(
      "href",
      "/gunluk-plan",
    );
    expect(within(actions).getByRole("link", { name: /Görev oluştur/u })).toHaveAttribute(
      "href",
      "/gorevler?action=create",
    );
    expect(within(actions).getByRole("link", { name: /Gider ekle/u })).toHaveAttribute(
      "href",
      "/finans/giderler?action=create",
    );
    expect(within(actions).getByRole("link", { name: /Nakit akışı/u })).toHaveAttribute(
      "href",
      "/finans/nakit-akisi",
    );
    expect(screen.getAllByText("Atlas Makina")).toHaveLength(2);
    expect(screen.getByText("Risk kontrolü")).toBeVisible();
    expect(screen.getByText("Danışmanlık tahsilatı")).toBeVisible();
    expect(screen.getByText("KDV")).toBeVisible();
    expect(screen.getByText("₺1.250,00")).toBeVisible();
  });

  it("omits financial content and writes when permissions are absent", () => {
    render(
      <MyDayWorkspace
        capabilities={{
          ...fullCapabilities,
          canCreateExpenses: false,
          canCreateTasks: false,
          canReadFinance: false,
        }}
        overview={{ ...overview, financeItems: undefined }}
      />,
    );

    expect(screen.queryByText("Finans ajandası")).toBeNull();
    expect(screen.queryByText("Danışmanlık tahsilatı")).toBeNull();
    expect(screen.queryByRole("link", { name: /Gider ekle/u })).toBeNull();
    expect(screen.getByRole("link", { name: /Görevleri aç/u })).toHaveAttribute(
      "href",
      "/gorevler",
    );
  });
});
