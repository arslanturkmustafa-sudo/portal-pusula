import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DailyPlanWorkspace } from "@/components/home/daily-plan-workspace";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
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
      await screen.findByText("Bu gün için planlanmış ziyaret bulunmuyor."),
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
    expect(screen.getByText("Günün ziyaretleri yükleniyor…")).toBeInTheDocument();

    resolveFirst?.(jsonResponse({ status: "service_unavailable" }, 503));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Günlük plana ulaşılamadı.",
    );

    await user.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(
      await screen.findByText("Bu gün için planlanmış ziyaret bulunmuyor."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
