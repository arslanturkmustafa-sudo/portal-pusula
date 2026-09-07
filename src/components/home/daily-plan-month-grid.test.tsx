import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DailyPlanMonthGrid,
  type DailyPlanMonthTask,
  type DailyPlanMonthVisit,
} from "./daily-plan-month-grid";

const visit: DailyPlanMonthVisit = {
  committedOn: "2026-09-04",
  contractId: "contract-1",
  customerCode: "ATLAS",
  customerId: "customer-1",
  customerName: "Atlas Makina",
  internalPlannedAtUtc: "2026-09-04 06:30:00.000000",
  locationLabel: "Atlas saha",
  resolutionStatus: "planned",
  visitId: "visit-1",
};

const tasks: readonly DailyPlanMonthTask[] = [
  {
    calendarOn: "2026-09-04",
    calendarSource: "visit",
    customerId: "customer-1",
    customerName: "Atlas Makina",
    dueOn: "2026-09-20",
    id: "task-1",
    linkedVisitId: "visit-1",
    locationLabel: "Atlas saha",
    projectName: "Danışmanlık",
    status: "in_progress",
    title: "Saha raporunu hazırla",
  },
  {
    calendarOn: "2026-09-07",
    calendarSource: "due_date",
    customerId: null,
    customerName: null,
    dueOn: "2026-09-07",
    id: "task-2",
    linkedVisitId: null,
    locationLabel: null,
    projectName: "İç operasyon",
    status: "todo",
    title: "Aylık kontrolü kapat",
  },
];

describe("DailyPlanMonthGrid", () => {
  it("renders a Monday-first seven-column month and places records on calendar days", () => {
    render(
      <DailyPlanMonthGrid
        endDate="2026-09-30"
        onOpenDay={vi.fn()}
        renderVisitAction={(item) => <button type="button">{item.customerCode} işlemi</button>}
        startDate="2026-09-01"
        tasks={tasks}
        today="2026-09-04"
        visits={[visit]}
      />,
    );

    const table = screen.getByRole("table", { name: "Eylül 2026 plan takvimi" });
    expect(
      within(table).getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual([
      "Pazartesi",
      "Salı",
      "Çarşamba",
      "Perşembe",
      "Cuma",
      "Cumartesi",
      "Pazar",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    const firstWeek = within(table).getAllByRole("row")[1];
    const firstWeekCells = within(firstWeek).getAllByRole("cell");
    expect(firstWeekCells).toHaveLength(7);
    expect(firstWeekCells[0]).toHaveAccessibleName(
      "Pazartesi, bu ayın dışında",
    );
    expect(firstWeekCells[0]).not.toHaveAttribute("aria-hidden");

    const fourth = within(table).getByRole("cell", {
      name: /4 Eylül 2026 Cuma, 1 ziyaret, 1 görev/u,
    });
    expect(fourth).toHaveTextContent("Atlas Makina");
    expect(fourth).toHaveTextContent("09:30");
    expect(fourth).toHaveTextContent("Saha raporunu hazırla");
    expect(fourth).toHaveTextContent("Ziyarete bağlı");
    expect(fourth).toHaveTextContent("Atlas saha");
    expect(within(fourth).getByRole("button", { name: "ATLAS işlemi" })).toBeInTheDocument();

    const seventh = within(table).getByRole("cell", {
      name: /7 Eylül 2026 Pazartesi, 1 görev/u,
    });
    expect(seventh).toHaveTextContent("Aylık kontrolü kapat");
    expect(seventh).toHaveTextContent("Vade günü");
    expect(
      within(table).getByRole("cell", { name: /20 Eylül 2026 Pazar, plan yok/u }),
    ).not.toHaveTextContent("Saha raporunu hazırla");
  });

  it("opens a calendar day and exposes the horizontal-scroll region", async () => {
    const onOpenDay = vi.fn();
    const user = userEvent.setup();

    render(
      <DailyPlanMonthGrid
        endDate="2026-09-30"
        onOpenDay={onOpenDay}
        startDate="2026-09-01"
        today="2026-09-04"
        visits={[]}
      />,
    );

    const scrollRegion = screen.getByRole("region", {
      name: "Eylül 2026 aylık plan takvimi",
    });
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(scrollRegion).toHaveAccessibleDescription(
      "Takvimin tamamını görmek için yatay kaydırın.",
    );

    await user.click(
      within(scrollRegion).getByRole("button", {
        name: "14 Eylül 2026 Pazartesi günlük görünümünü aç",
      }),
    );
    expect(onOpenDay).toHaveBeenCalledWith("2026-09-14");
  });

  it("caps dense calendar cells and opens the full day from the remainder control", async () => {
    const onOpenDay = vi.fn();
    const user = userEvent.setup();
    const denseVisits = [0, 1, 2].map((index) => ({
      ...visit,
      customerName: `Müşteri ${index + 1}`,
      visitId: `visit-${index + 1}`,
    }));
    const denseTasks = [0, 1, 2].map((index) => ({
      ...tasks[0],
      id: `task-${index + 1}`,
      title: `Görev ${index + 1}`,
    }));

    render(
      <DailyPlanMonthGrid
        endDate="2026-09-30"
        onOpenDay={onOpenDay}
        startDate="2026-09-01"
        tasks={denseTasks}
        today="2026-09-07"
        visits={denseVisits}
      />,
    );

    expect(screen.getByText("Müşteri 2")).toBeInTheDocument();
    expect(screen.queryByText("Müşteri 3")).not.toBeInTheDocument();
    expect(screen.getByText("Görev 2")).toBeInTheDocument();
    expect(screen.queryByText("Görev 3")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /4 Eylül 2026 Cuma için kalan 2 kaydı/u,
      }),
    );
    expect(onOpenDay).toHaveBeenCalledWith("2026-09-04");
  });
});
