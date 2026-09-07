import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DailyPlanWorkspace } from "@/components/home/daily-plan-workspace";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  let responseBody = body;
  if (
    body !== null &&
    typeof body === "object" &&
    "date" in body &&
    typeof body.date === "string" &&
    "items" in body &&
    !("range" in body)
  ) {
    responseBody = {
      ...body,
      range: { endDate: body.date, startDate: body.date },
      view: "day",
    };
  }
  return new Response(JSON.stringify(responseBody), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function currentIstanbulDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekRange(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return {
    endDate: shiftDate(value, 6 - daysSinceMonday),
    startDate: shiftDate(value, -daysSinceMonday),
  };
}

describe("DailyPlanWorkspace", () => {
  it("loads Istanbul today and separates timed and untimed visits", async () => {
    const today = currentIstanbulDate();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        date: today,
        items: [
          {
            committedOn: today,
            contractId: "contract-1",
            customerCode: "ATLAS",
            customerId: "customer-1",
            customerName: "Atlas Makina",
            internalDurationMinutes: 45,
            internalPlannedAtUtc: `${today} 06:30:00.000000`,
            resolutionStatus: "planned",
            visitId: "visit-1",
          },
          {
            committedOn: today,
            contractId: "contract-2",
            customerCode: "VEGA",
            customerId: "customer-2",
            customerName: "Vega Endüstri",
            internalDurationMinutes: 60,
            internalPlannedAtUtc: `${today} 10:00:00.000000`,
            resolutionStatus: "completed",
            visitId: "visit-2",
          },
          {
            committedOn: today,
            contractId: "contract-3",
            customerCode: "NOVA",
            customerId: "customer-3",
            customerName: "Nova Lojistik",
            internalDurationMinutes: null,
            internalPlannedAtUtc: null,
            resolutionStatus: "makeup_pending",
            visitId: "visit-3",
          },
          {
            committedOn: today,
            contractId: "contract-4",
            customerCode: "MIRA",
            customerId: "customer-4",
            customerName: "Mira Teknoloji",
            internalDurationMinutes: 30,
            internalPlannedAtUtc: null,
            resolutionStatus: "cancelled_by_agreement",
            visitId: "visit-4",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DailyPlanWorkspace />);

    const timeline = await screen.findByRole("region", {
      name: "Saatli ziyaretler",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/daily-plan?date=${today}`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    expect(within(timeline).getByText("Atlas Makina")).toBeInTheDocument();
    expect(within(timeline).getByText("ATLAS")).toBeInTheDocument();
    expect(within(timeline).getByText("09:30–10:15")).toBeInTheDocument();
    expect(within(timeline).getByText("45 dk")).toBeInTheDocument();
    expect(within(timeline).getByText("Planlandı")).toBeInTheDocument();
    expect(within(timeline).getByText("Tamamlandı")).toBeInTheDocument();

    const untimed = screen.getByRole("region", { name: "Saat belirlenmedi" });
    expect(within(untimed).getByText("Nova Lojistik")).toBeInTheDocument();
    expect(within(untimed).getByText("Telafi bekliyor")).toBeInTheDocument();
    expect(within(untimed).getByText("Mira Teknoloji")).toBeInTheDocument();
    expect(within(untimed).getByText("Mutabakatla iptal")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ziyaretini tamamla/u }),
    ).not.toBeInTheDocument();
  });

  it("moves between days, accepts a date input and shows an empty day", async () => {
    const today = currentIstanbulDate();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const date = new URL(String(input), "https://portal.example").searchParams.get(
        "date",
      );
      return jsonResponse({ date, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace />);
    expect(
      await screen.findByText("Bu dönem için planlanmış ziyaret veya görev bulunmuyor."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sonraki gün" }));
    const tomorrow = shiftDate(today, 1);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/daily-plan?date=${tomorrow}`,
        expect.any(Object),
      );
    });

    const chosenDate = "2026-12-31";
    fireEvent.change(screen.getByLabelText("Plan tarihi"), {
      target: { value: chosenDate },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/daily-plan?date=${chosenDate}`,
        expect.any(Object),
      );
    });

    await user.click(screen.getByRole("button", { name: "Önceki gün" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/daily-plan?date=2026-12-30",
        expect.any(Object),
      );
    });

    fireEvent.change(screen.getByLabelText("Plan tarihi"), {
      target: { value: "1000-01-01" },
    });
    expect(screen.getByRole("button", { name: "Önceki gün" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Plan tarihi"), {
      target: { value: "9999-12-31" },
    });
    expect(screen.getByRole("button", { name: "Sonraki gün" })).toBeDisabled();
  });

  it("switches between daily, weekly and monthly reports and groups visits by day", async () => {
    const anchor = "2026-09-02";
    const weeklyRange = weekRange(anchor);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "https://portal.example");
      const date = url.searchParams.get("date") ?? anchor;
      const view = url.searchParams.get("view") ?? "day";
      if (view === "week") {
        return jsonResponse({
          date,
          items: [
            {
              committedOn: weeklyRange.startDate,
              contractId: "contract-1",
              customerCode: "ATLAS",
              customerId: "customer-1",
              customerName: "Atlas Makina",
              internalDurationMinutes: 45,
              internalPlannedAtUtc: `${weeklyRange.startDate} 06:30:00.000000`,
              resolutionStatus: "planned",
              visitId: "visit-1",
            },
            {
              committedOn: "2026-09-04",
              contractId: "contract-2",
              customerCode: "VEGA",
              customerId: "customer-2",
              customerName: "Vega Endüstri",
              internalDurationMinutes: null,
              internalPlannedAtUtc: null,
              resolutionStatus: "completed",
              visitId: "visit-2",
            },
          ],
          range: weeklyRange,
          tasks: [
            {
              calendarOn: "2026-09-03",
              calendarSource: "due_date",
              customerName: "Vega Endüstri",
              dueOn: "2026-09-03",
              id: "task-week-1",
              linkedVisitId: null,
              projectName: "Danışmanlık",
              status: "in_progress",
              title: "Teklif revizyonunu bitir",
            },
          ],
          view,
        });
      }
      if (view === "month") {
        return jsonResponse({
          date,
          items: [
            {
              committedOn: "2026-09-04",
              contractId: "contract-2",
              customerCode: "VEGA",
              customerId: "customer-2",
              customerName: "Vega Endüstri",
              internalDurationMinutes: null,
              internalPlannedAtUtc: null,
              resolutionStatus: "completed",
              visitId: "visit-2",
            },
          ],
          range: { endDate: "2026-09-30", startDate: "2026-09-01" },
          tasks: [
            {
              calendarOn: "2026-09-04",
              calendarSource: "visit",
              customerName: "Vega Endüstri",
              dueOn: "2026-09-18",
              id: "task-1",
              linkedVisitId: "visit-2",
              projectName: "Danışmanlık",
              status: "todo",
              title: "Ziyaret raporunu gönder",
            },
          ],
          view,
        });
      }
      return jsonResponse({ date, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace />);
    await screen.findByText("Bu dönem için planlanmış ziyaret veya görev bulunmuyor.");
    fireEvent.change(screen.getByLabelText("Plan tarihi"), {
      target: { value: anchor },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/daily-plan?date=${anchor}`,
        expect.any(Object),
      );
    });

    await user.click(screen.getByRole("button", { name: "Haftalık" }));
    expect(await screen.findByRole("heading", { name: "Haftalık plan" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/daily-plan?date=${anchor}&view=week`,
      expect.any(Object),
    );
    expect(screen.getByRole("region", { name: /31 Ağustos 2026 Pazartesi/u })).toHaveTextContent(
      "Atlas Makina",
    );
    expect(screen.getByRole("region", { name: /4 Eylül 2026 Cuma/u })).toHaveTextContent(
      "Vega Endüstri",
    );
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("2 ziyaret");
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("3 planlı gün");
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("1 görev");
    const taskOnlyDay = screen.getByRole("region", {
      name: /3 Eylül 2026 Perşembe/u,
    });
    const taskList = within(taskOnlyDay).getByRole("region", { name: "Görevler" });
    expect(taskList).toHaveTextContent("Teklif revizyonunu bitir");
    expect(taskList).toHaveTextContent("Vega Endüstri · Danışmanlık");
    expect(taskList).toHaveTextContent("Devam ediyor");
    expect(taskList).toHaveTextContent("Vade: 3 Eyl 2026");
    expect(taskList).toHaveTextContent("Vade günü");

    await user.click(screen.getByRole("button", { name: "Aylık" }));
    expect(await screen.findByRole("heading", { name: "Aylık plan" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/daily-plan?date=${anchor}&view=month`,
      expect.any(Object),
    );
    const monthTable = await screen.findByRole("table", {
      name: "Eylül 2026 plan takvimi",
    });
    expect(within(monthTable).getAllByRole("columnheader")).toHaveLength(7);
    const visitDay = within(monthTable).getByRole("cell", {
      name: /4 Eylül 2026 Cuma, 1 ziyaret, 1 görev/u,
    });
    expect(visitDay).toHaveTextContent("Vega Endüstri");
    expect(visitDay).toHaveTextContent("Ziyaret raporunu gönder");
    expect(visitDay).toHaveTextContent("Ziyarete bağlı");
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("1 görev");
  });

  it("filters every calendar view by customer and location and exposes authenticated outputs", async () => {
    const date = "2026-09-02";
    const atlasId = "10000000-0000-4000-8000-000000000001";
    const vegaId = "10000000-0000-4000-8000-000000000002";
    const emptyCustomerId = "10000000-0000-4000-8000-000000000003";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "https://portal.example");
      const view = (url.searchParams.get("view") ?? "day") as
        | "day"
        | "week"
        | "month";
      return jsonResponse({
        customers: [
          { code: "ATLAS", id: atlasId, name: "Atlas Makina" },
          { code: "VEGA", id: vegaId, name: "Vega Endüstri" },
          { code: "NOVA", id: emptyCustomerId, name: "Nova Kimya" },
        ],
        date,
        items: [
          {
            committedOn: date,
            contractId: "contract-atlas",
            customerCode: "ATLAS",
            customerId: atlasId,
            customerName: "Atlas Makina",
            internalDurationMinutes: 45,
            internalPlannedAtUtc: `${date} 06:30:00.000000`,
            locationLabel: "Merkez ofis",
            resolutionStatus: "planned",
            visitId: "visit-atlas",
          },
          {
            committedOn: date,
            contractId: "contract-vega",
            customerCode: "VEGA",
            customerId: vegaId,
            customerName: "Vega Endüstri",
            internalDurationMinutes: null,
            internalPlannedAtUtc: null,
            locationLabel: "Fabrika",
            resolutionStatus: "planned",
            visitId: "visit-vega",
          },
        ],
        range:
          view === "month"
            ? { endDate: "2026-09-30", startDate: "2026-09-01" }
            : view === "week"
              ? weekRange(date)
              : { endDate: date, startDate: date },
        tasks: [
          {
            calendarOn: date,
            calendarSource: "visit",
            customerId: atlasId,
            customerName: "Atlas Makina",
            dueOn: "2026-09-05",
            id: "task-atlas",
            linkedVisitId: "visit-atlas",
            locationLabel: "Çevrim içi",
            projectName: "Danışmanlık",
            status: "todo",
            title: "Atlas toplantı notu",
          },
        ],
        view,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace />);
    fireEvent.change(screen.getByLabelText("Plan tarihi"), {
      target: { value: date },
    });
    expect(await screen.findByText("Atlas Makina", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Vega Endüstri", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ICS indir" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Nova Kimya · NOVA" }),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Takvimi müşteriye göre filtrele"),
      atlasId,
    );
    expect(screen.queryByText("Vega Endüstri", { selector: "strong" })).not.toBeInTheDocument();
    const icsLink = screen.getByRole("link", { name: "ICS indir" });
    expect(icsLink).toHaveAttribute(
      "href",
      `/api/daily-plan/export?customerId=${atlasId}&date=${date}&view=day&format=ics`,
    );
    expect(icsLink).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "Yazdırılabilir görünüm" })).toHaveAttribute(
      "target",
      "_blank",
    );

    await user.selectOptions(
      screen.getByLabelText("Takvimi konuma göre filtrele"),
      "Çevrim içi",
    );
    expect(screen.queryByText("Atlas Makina", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.getByText("Atlas toplantı notu")).toBeInTheDocument();
    expect(screen.getByText("Konum · Çevrim içi")).toBeInTheDocument();
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("0 ziyaret");
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("1 görev");
    const scopedExportQuery = new URLSearchParams({
      customerId: atlasId,
      date,
      view: "day",
      location: "Çevrim içi",
    });
    expect(screen.getByRole("link", { name: "ICS indir" })).toHaveAttribute(
      "href",
      `/api/daily-plan/export?${scopedExportQuery.toString()}&format=ics`,
    );
    expect(
      screen.getByRole("link", { name: "Yazdırılabilir görünüm" }),
    ).toHaveAttribute(
      "href",
      `/api/daily-plan/export?${scopedExportQuery.toString()}&format=print`,
    );

    await user.click(screen.getByRole("button", { name: "Aylık" }));
    const monthTable = await screen.findByRole("table", {
      name: "Eylül 2026 plan takvimi",
    });
    expect(within(monthTable).getByText("Atlas toplantı notu")).toBeInTheDocument();
    expect(within(monthTable).queryByText("Vega Endüstri")).not.toBeInTheDocument();
    scopedExportQuery.set("view", "month");
    expect(screen.getByRole("link", { name: "ICS indir" })).toHaveAttribute(
      "href",
      `/api/daily-plan/export?${scopedExportQuery.toString()}&format=ics`,
    );

    await user.selectOptions(
      screen.getByLabelText("Takvimi müşteriye göre filtrele"),
      emptyCustomerId,
    );
    expect(screen.getByRole("link", { name: "ICS indir" })).toHaveAttribute(
      "href",
      `/api/daily-plan/export?customerId=${emptyCustomerId}&date=${date}&view=month&format=ics`,
    );
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent("0 ziyaret");
    expect(
      within(
        screen.getByRole("table", { name: "Eylül 2026 plan takvimi" }),
      ).queryByText("Atlas Makina"),
    ).not.toBeInTheDocument();
  });

  it("completes a planned visit in place when the account has visit write access", async () => {
    const today = currentIstanbulDate();
    const visit = {
      committedOn: today,
      contractId: "contract-1",
      customerCode: "ATLAS",
      customerId: "customer-1",
      customerName: "Atlas Makina",
      internalDurationMinutes: 45,
      internalPlannedAtUtc: `${today} 06:30:00.000000`,
      resolutionStatus: "planned",
      visitId: "visit-1",
    } as const;
    let completed = false;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "PATCH") {
        completed = true;
        return jsonResponse({
          tasks: [],
          visit: { id: visit.visitId, resolutionStatus: "completed" },
        });
      }
      return jsonResponse({
        date: today,
        items: [
          completed ? { ...visit, resolutionStatus: "completed" } : visit,
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace canWriteTasks canWriteVisits />);
    await user.click(
      await screen.findByRole("button", {
        name: /Atlas Makina.*ziyaretini tamamla/u,
      }),
    );
    expect(
      screen.getByRole("group", { name: "Tamamlanan çalışmalar" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tamamla ve kaydet" }));

    expect(
      await screen.findByText("Atlas Makina ziyareti tamamlandı."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/customers/customer-1/contracts/contract-1/visits/visit-1",
      expect.objectContaining({
        body: JSON.stringify({
          deliveredOn: today,
          resolutionNote: null,
          resolutionStatus: "completed",
          workItems: [],
        }),
        credentials: "same-origin",
        method: "PATCH",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      screen.queryByRole("button", { name: /ziyaretini tamamla/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dönem özeti")).toHaveTextContent(
      "1 tamamlanan ziyaret",
    );
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method !== "PATCH"),
    ).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByText("ATLAS").closest("article")).toHaveFocus();
    });
  });

  it("shows loading, reports failures and retries the selected date", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const today = currentIstanbulDate();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(jsonResponse({ date: today, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace />);
    expect(
      screen.getByText("Planlanan ziyaretler yükleniyor…"),
    ).toBeInTheDocument();

    resolveFirst?.(jsonResponse({ status: "service_unavailable" }, 503));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Plan görünümüne ulaşılamadı.",
    );

    await user.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(
      await screen.findByText("Bu dönem için planlanmış ziyaret veya görev bulunmuyor."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
