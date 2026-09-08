import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/navigation/portal-return-path", () => ({
  redirectToPortalLogin: vi.fn(),
}));

import { CashFlowWorkspace } from "@/components/home/cash-flow-workspace";

const weeklyReport = {
  actual: {
    entryCount: 4,
    inflowAmount: "400.0000",
    netAmount: "250.0000",
    outflowAmount: "150.0000",
  },
  assumptions: ["İç transferler brüt giriş veya çıkışı şişirmez."],
  balance: {
    accountOpeningAmount: "250.0000",
    accountCount: 2,
    asOfOn: "2026-09-20",
    closingBalanceAmount: "1500.0000",
    openingBalanceAmount: "1000.0000",
    status: "configured",
  },
  forecast: {
    lines: [
      {
        amount: "500.0000",
        bucket: "scheduled",
        direction: "inflow",
        entryCount: 1,
        eventOn: "2026-09-10",
        kind: "customer_receivable",
      },
      {
        amount: "35.0000",
        bucket: "overdue",
        direction: "outflow",
        entryCount: 1,
        eventOn: "2026-09-15",
        kind: "card_installment",
      },
      {
        amount: "80.0000",
        bucket: "scheduled",
        direction: "outflow",
        entryCount: 2,
        eventOn: "2026-09-18",
        kind: "card_installment",
      },
    ],
    overdue: {
      inflowAmount: "0.0000",
      netAmount: "-35.0000",
      outflowAmount: "35.0000",
    },
    overdueInRange: {
      inflowAmount: "0.0000",
      netAmount: "-35.0000",
      outflowAmount: "35.0000",
    },
    scheduled: {
      inflowAmount: "500.0000",
      netAmount: "420.0000",
      outflowAmount: "80.0000",
    },
    undatedInflowAmount: "25.0000",
  },
  generatedOn: "2026-09-20",
  granularity: "weekly",
  movements: [
    {
      amount: "300.0000",
      direction: "inflow",
      eventOn: "2026-09-08",
      id: "actual-1",
      kind: "finance_transaction",
      label: "Müşteri tahsilatı",
      sourceLabel: "Ana banka",
      status: "actual",
    },
    {
      amount: "45.0000",
      direction: "outflow",
      eventOn: "2026-09-09",
      id: "module-actual-1",
      kind: "direct_expense",
      label: "Ödenen ofis gideri",
      sourceLabel: "Giderler",
      status: "actual",
    },
    {
      amount: "35.0000",
      direction: "outflow",
      eventOn: "2026-09-15",
      id: "overdue-1",
      kind: "card_installment",
      label: "Kredi kartı taksiti",
      sourceLabel: "Şirket kartı",
      status: "overdue",
    },
    {
      amount: "80.0000",
      direction: "outflow",
      eventOn: "2026-09-18",
      id: "scheduled-1",
      kind: "card_installment",
      label: "Kredi kartı taksiti",
      sourceLabel: "Şirket kartı",
      status: "scheduled",
    },
    {
      amount: "90.0000",
      direction: "outflow",
      eventOn: "2026-09-21",
      id: "outside-range",
      kind: "direct_expense",
      label: "Aralık dışı gider",
      sourceLabel: null,
      status: "scheduled",
    },
  ],
  periods: [
    {
      accountOpeningAmount: "0.0000",
      actual: {
        entryCount: 2,
        inflowAmount: "300.0000",
        netAmount: "250.0000",
        outflowAmount: "50.0000",
      },
      closingBalanceAmount: "1250.0000",
      endOn: "2026-09-13",
      forecast: {
        overdue: {
          inflowAmount: "0.0000",
          netAmount: "0.0000",
          outflowAmount: "0.0000",
        },
        scheduled: {
          inflowAmount: "200.0000",
          netAmount: "200.0000",
          outflowAmount: "0.0000",
        },
      },
      openingBalanceAmount: "1000.0000",
      startOn: "2026-09-07",
    },
    {
      accountOpeningAmount: "250.0000",
      actual: {
        entryCount: 2,
        inflowAmount: "100.0000",
        netAmount: "0.0000",
        outflowAmount: "100.0000",
      },
      closingBalanceAmount: "1500.0000",
      endOn: "2026-09-20",
      forecast: {
        overdue: {
          inflowAmount: "0.0000",
          netAmount: "-35.0000",
          outflowAmount: "35.0000",
        },
        scheduled: {
          inflowAmount: "300.0000",
          netAmount: "220.0000",
          outflowAmount: "80.0000",
        },
      },
      openingBalanceAmount: "1250.0000",
      startOn: "2026-09-14",
    },
  ],
  range: { from: "2026-09-07", to: "2026-09-20" },
  unclassifiedExpenses: { amount: "12.0000", entryCount: 1 },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("CashFlowWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(weeklyReport)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders reconciled totals, period balances and an accessible trend", async () => {
    render(<CashFlowWorkspace />);

    expect(await screen.findByText("2 hesap uzlaştırıldı.")).toBeVisible();
    const opening = screen.getByText("Dönem açılışı").closest("div");
    const accountOpening = screen
      .getByText("Yeni hesap açılışı", { selector: "dt" })
      .closest("div");
    const ledgerInflow = screen
      .getByText("Hesaba işlenen gelir", { selector: "dt" })
      .closest("div");
    const ledgerOutflow = screen
      .getByText("Hesaptan çıkan gider", { selector: "dt" })
      .closest("div");
    const closing = screen.getByText("Kapanış bakiyesi").closest("div");
    expect(opening).not.toBeNull();
    expect(accountOpening).not.toBeNull();
    expect(ledgerInflow).not.toBeNull();
    expect(ledgerOutflow).not.toBeNull();
    expect(closing).not.toBeNull();
    expect(within(opening!).getByText("₺1.000")).toBeVisible();
    expect(within(accountOpening!).getByText("₺250")).toBeVisible();
    expect(within(ledgerInflow!).getByText("₺400")).toBeVisible();
    expect(within(ledgerOutflow!).getByText("₺150")).toBeVisible();
    expect(within(closing!).getByText("₺1.500")).toBeVisible();

    const detail = screen.getByRole("region", {
      name: "Nakit hareketleri tablosu",
    });
    expect(detail).toHaveAttribute("tabindex", "0");
    expect(
      within(detail).getByRole("columnheader", { name: "Tarih" }),
    ).toBeVisible();
    expect(
      within(detail).getByRole("columnheader", { name: "Hareket" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "7 Eyl – 13 Eyl 2026 gelir ₺300" }),
    ).toBeVisible();
    expect(screen.getByText("Gelir ₺300")).toBeInTheDocument();
    expect(screen.getByText("Gider ₺50")).toBeInTheDocument();
    expect(
      screen.getByText(/kaynak kaydıyla hesap hareketi eşleştirilemediğinde/iu),
    ).toBeVisible();
    expect(screen.getByText(/bu tablodan toplam hesaplanmaz/iu)).toBeVisible();
    const scope = screen.getByRole("complementary", {
      name: "Nakit akışı rapor kapsamı",
    });
    expect(within(scope).getByText("Birleşik tablo kapsamı")).toBeVisible();
    expect(
      within(scope).getByText(/hesap defterine işlenen hareketler/iu),
    ).toBeVisible();
    expect(
      within(scope).getByText(/kendi modülünde ödendi veya tahsil edildi/iu),
    ).toBeVisible();
    expect(
      within(scope).getByText(/açık planlanan ya da gecikmiş kalemler/iu),
    ).toBeVisible();
    expect(
      within(scope).getByText(/aynı işlem iki ayrı satırda görünebilir/iu),
    ).toBeVisible();
    expect(within(scope).getByText(/birleşik toplam gösterilmez/iu)).toBeVisible();
    const trend = screen.getByRole("region", {
      name: "Dönemsel hesap giriş / çıkışı",
    });
    expect(within(trend).getByText("Hesap defteri hareketleri")).toBeVisible();
    const zeroPeriod = within(trend).getByText("14 Eyl – 20 Eyl 2026").closest("li");
    expect(zeroPeriod).not.toBeNull();
    expect(within(zeroPeriod!).getByText("₺0 net").className).toMatch(/neutral/u);
    expect(screen.getByText("4 hesap hareketi")).toBeVisible();
  });

  it("shows all in-range movements in date order with explicit status and direction", async () => {
    render(<CashFlowWorkspace />);

    const movementRegion = await screen.findByRole("region", {
      name: "Nakit hareketleri tablosu",
    });
    const rows = within(movementRegion).getAllByRole("row");
    expect(rows).toHaveLength(5);

    expect(within(rows[1]!).getByText("8 Eyl 2026")).toBeVisible();
    expect(within(rows[1]!).getByText("Müşteri tahsilatı")).toBeVisible();
    expect(within(rows[1]!).getByText("Ana banka")).toBeVisible();
    expect(within(rows[1]!).getByText("Gerçekleşti")).toBeVisible();
    expect(within(rows[1]!).getByText("Giriş")).toBeVisible();
    expect(within(rows[1]!).getByText("+₺300")).toBeVisible();

    expect(within(rows[2]!).getByText("9 Eyl 2026")).toBeVisible();
    expect(within(rows[2]!).getByText("Ödenen ofis gideri")).toBeVisible();
    expect(within(rows[2]!).getByText("Giderler")).toBeVisible();
    expect(within(rows[2]!).getByText("Gerçekleşti")).toBeVisible();
    expect(within(rows[2]!).getByText("Çıkış")).toBeVisible();
    expect(within(rows[2]!).getByText("−₺45")).toBeVisible();

    expect(within(rows[3]!).getByText("15 Eyl 2026")).toBeVisible();
    expect(within(rows[3]!).getByText("Gecikmiş")).toBeVisible();
    expect(within(rows[3]!).getByText("−₺35")).toBeVisible();

    expect(within(rows[4]!).getByText("18 Eyl 2026")).toBeVisible();
    expect(within(rows[4]!).getByText("Planlandı")).toBeVisible();
    expect(within(rows[4]!).getByText("−₺80")).toBeVisible();
    expect(
      within(movementRegion).queryByText("Aralık dışı gider"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Kredi kartı vade planı" }),
    ).not.toBeInTheDocument();
  });

  it("shows an honest empty state when the range has no movements", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...weeklyReport, movements: [] }),
    );

    render(<CashFlowWorkspace />);

    const movementRegion = await screen.findByRole("region", {
      name: "Nakit hareketleri tablosu",
    });
    expect(
      within(movementRegion).getByText(
        "Seçilen tarih aralığında gerçekleşen, planlanan veya gecikmiş nakit hareketi yok.",
      ),
    ).toBeVisible();
    expect(within(movementRegion).getAllByRole("row")).toHaveLength(2);
  });

  it("requests the exact inclusive range and selected monthly granularity", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<CashFlowWorkspace />);
    await screen.findByText("2 hesap uzlaştırıldı.");

    fireEvent.click(screen.getByRole("radio", { name: "Aylık" }));
    fireEvent.change(screen.getByLabelText("Başlangıç"), {
      target: { value: "2026-07-15" },
    });
    fireEvent.change(screen.getByLabelText("Bitiş"), {
      target: { value: "2026-09-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Raporu oluştur" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const requested = new URL(String(fetchMock.mock.calls[1]?.[0]), "https://portal.test");
    expect(Object.fromEntries(requested.searchParams)).toEqual({
      from: "2026-07-15",
      granularity: "monthly",
      to: "2026-09-20",
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("rejects an inverted range on the client without issuing another request", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<CashFlowWorkspace />);
    await screen.findByText("2 hesap uzlaştırıldı.");

    fireEvent.change(screen.getByLabelText("Başlangıç"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Bitiş"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Raporu oluştur" }).closest("form")!);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitiş tarihi başlangıç tarihinden önce olamaz.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Bitiş"), {
      target: { value: "2026-10-02" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
