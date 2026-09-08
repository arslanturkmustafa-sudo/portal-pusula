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
    currentAssetAmount: "1500.0000",
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
      netAmount: "-55.0000",
      outflowAmount: "55.0000",
    },
    overdueInRange: {
      inflowAmount: "0.0000",
      netAmount: "-35.0000",
      outflowAmount: "35.0000",
    },
    scheduled: {
      inflowAmount: "500.0000",
      netAmount: "400.0000",
      outflowAmount: "100.0000",
    },
    undatedInflowAmount: "25.0000",
  },
  dueItems: [
    {
      direction: "inflow",
      dueOn: "2026-09-08",
      id: "receivable-settled-1",
      kind: "customer_receivable",
      label: "Ağustos danışmanlık alacağı",
      remainingAmount: "0.0000",
      settledAmount: "300.0000",
      sourceLabel: "Acme AŞ",
      status: "settled",
      totalAmount: "300.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-10",
      id: "expense-actual-1",
      kind: "other_expense",
      label: "Ofis giderleri",
      remainingAmount: "0.0000",
      settledAmount: "45.0000",
      sourceLabel: "1 gider kaydı",
      status: "actual",
      totalAmount: "45.0000",
    },
    {
      direction: "inflow",
      dueOn: "2026-09-12",
      id: "receivable-planned-1",
      kind: "customer_receivable",
      label: "Eylül danışmanlık alacağı",
      remainingAmount: "500.0000",
      settledAmount: "0.0000",
      sourceLabel: "Acme AŞ",
      status: "planned",
      totalAmount: "500.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-15",
      id: "card-overdue-1",
      kind: "card_payment",
      label: "Şirket kartı",
      remainingAmount: "35.0000",
      settledAmount: "0.0000",
      sourceLabel: "2 harcama · vade toplamı",
      status: "overdue",
      totalAmount: "35.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-18",
      id: "card-planned-1",
      kind: "card_payment",
      label: "Şirket kartı",
      remainingAmount: "80.0000",
      settledAmount: "0.0000",
      sourceLabel: "3 harcama · vade toplamı",
      status: "planned",
      totalAmount: "80.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-18",
      id: "expense-scheduled-1",
      kind: "other_expense",
      label: "Vergi giderleri",
      remainingAmount: "20.0000",
      settledAmount: "0.0000",
      sourceLabel: "1 gider kaydı",
      status: "scheduled",
      totalAmount: "20.0000",
    },
    {
      direction: "outflow",
      dueOn: "2026-09-21",
      id: "outside-range",
      kind: "other_expense",
      label: "Aralık dışı gider",
      remainingAmount: "90.0000",
      settledAmount: "0.0000",
      sourceLabel: "1 gider kaydı",
      status: "scheduled",
      totalAmount: "90.0000",
    },
  ],
  generatedOn: "2026-09-20",
  granularity: "weekly",
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
      name: "Vade planı tablosu",
    });
    expect(detail).toHaveAttribute("tabindex", "0");
    expect(
      within(detail).getByRole("columnheader", { name: "Vade" }),
    ).toBeVisible();
    expect(
      within(detail).getByRole("columnheader", { name: "Kalem" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "7 Eyl – 13 Eyl 2026 gelir ₺300" }),
    ).toBeVisible();
    expect(screen.getByText("Gelir ₺300")).toBeInTheDocument();
    expect(screen.getByText("Gider ₺50")).toBeInTheDocument();
    expect(
      screen.getByText(/kredi kartı borçları kart ve vade bazında toplam/iu),
    ).toBeVisible();
    expect(screen.getByText(/tekil kart harcamaları.*tekrarlanmaz/iu)).toBeVisible();
    const scope = screen.getByRole("complementary", {
      name: "Nakit akışı rapor kapsamı",
    });
    expect(within(scope).getByText("İki ayrı görünüm")).toBeVisible();
    expect(
      within(scope).getByText(/hesap defterindeki gerçekleşen giriş ve çıkışları korur/iu),
    ).toBeVisible();
    expect(
      within(scope).getByText(/alacak ve tahsilatları/iu),
    ).toBeVisible();
    expect(
      within(scope).getByText(/kredi kartlarının vade bazındaki toplam ödemelerini/iu),
    ).toBeVisible();
    expect(
      within(scope).getByText(/ileri tarihli diğer ödeme planlarını kategori ve.*tarih bazında/iu),
    ).toBeVisible();
    expect(within(scope).getByText(/tek tek kredi kartı harcamaları/iu)).toBeVisible();
    const trend = screen.getByRole("region", {
      name: "Dönemsel hesap giriş / çıkışı",
    });
    expect(within(trend).getByText("Hesap defteri hareketleri")).toBeVisible();
    const zeroPeriod = within(trend).getByText("14 Eyl – 20 Eyl 2026").closest("li");
    expect(zeroPeriod).not.toBeNull();
    expect(within(zeroPeriod!).getByText("₺0 net").className).toMatch(/neutral/u);
    expect(screen.getByText("4 hesap hareketi")).toBeVisible();
  });

  it("shows due-based totals and a day-end asset projection without replaying settled items", async () => {
    render(<CashFlowWorkspace />);

    const movementRegion = await screen.findByRole("region", {
      name: "Vade planı tablosu",
    });
    const rows = within(movementRegion).getAllByRole("row");
    expect(rows).toHaveLength(7);

    const actualAsset = screen.getByText("Gerçek varlık").closest("div");
    const carryover = screen.getByText("Devreden gecikmiş açıklar").closest("div");
    const projectedAsset = screen
      .getByText("Dönem sonu öngörülen varlık")
      .closest("div");
    expect(within(actualAsset!).getByText("₺1.500")).toBeVisible();
    expect(within(carryover!).getByText("₺-20")).toBeVisible();
    expect(within(projectedAsset!).getByText("₺1.845")).toBeVisible();

    expect(within(rows[1]!).getByText("8 Eyl 2026")).toBeVisible();
    expect(within(rows[1]!).getByText("Ağustos danışmanlık alacağı")).toBeVisible();
    expect(within(rows[1]!).getByText("Müşteri alacağı · Acme AŞ")).toBeVisible();
    expect(within(rows[1]!).getByText("Alındı")).toBeVisible();
    expect(within(rows[1]!).getAllByText("₺300")).toHaveLength(2);
    expect(within(rows[1]!).getByText("₺1.480")).toBeVisible();

    expect(within(rows[2]!).getByText("10 Eyl 2026")).toBeVisible();
    expect(within(rows[2]!).getByText("Ofis giderleri")).toBeVisible();
    expect(
      within(rows[2]!).getByText("Diğer ödeme · 1 gider kaydı"),
    ).toBeVisible();
    expect(within(rows[2]!).getByText("Planlanan diğer ödeme")).toBeVisible();
    expect(within(rows[2]!).getByText("₺45")).toBeVisible();
    expect(within(rows[2]!).getAllByText("—")).toHaveLength(2);
    expect(within(rows[2]!).getByText("₺1.480")).toBeVisible();

    expect(within(rows[3]!).getByText("12 Eyl 2026")).toBeVisible();
    expect(within(rows[3]!).getByText("Eylül danışmanlık alacağı")).toBeVisible();
    expect(within(rows[3]!).getByText("Alınacak")).toBeVisible();
    expect(within(rows[3]!).getAllByText("₺500")).toHaveLength(2);
    expect(within(rows[3]!).getByText("₺1.980")).toBeVisible();

    expect(within(rows[4]!).getByText("15 Eyl 2026")).toBeVisible();
    expect(within(rows[4]!).getByText("Gecikmiş ödeme")).toBeVisible();
    expect(
      within(rows[4]!).getByText("Kredi kartı · 2 harcama · vade toplamı"),
    ).toBeVisible();
    expect(within(rows[4]!).getAllByText("₺35")).toHaveLength(2);
    expect(within(rows[4]!).getByText("₺1.945")).toBeVisible();

    expect(within(rows[5]!).getByText("18 Eyl 2026")).toBeVisible();
    expect(within(rows[5]!).getByText("Ödenecek")).toBeVisible();
    expect(within(rows[5]!).getByText("Şirket kartı")).toBeVisible();
    expect(within(rows[5]!).getAllByText("₺80")).toHaveLength(2);
    expect(within(rows[5]!).getByText("₺1.845")).toBeVisible();

    expect(within(rows[6]!).getByText("18 Eyl 2026")).toBeVisible();
    expect(within(rows[6]!).getByText("Vergi giderleri")).toBeVisible();
    expect(within(rows[6]!).getByText("Planlanan diğer ödeme")).toBeVisible();
    expect(within(rows[6]!).getByText("₺1.845")).toBeVisible();
    expect(
      within(movementRegion).queryByText("Aralık dışı gider"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Kredi kartı vade planı" }),
    ).not.toBeInTheDocument();
  });

  it("shows an honest empty state when the range has no due items", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...weeklyReport, dueItems: [] }),
    );

    render(<CashFlowWorkspace />);

    const movementRegion = await screen.findByRole("region", {
      name: "Vade planı tablosu",
    });
    expect(
      within(movementRegion).getByText(
        "Seçilen tarih aralığında vadeli alacak, tahsilat veya ödeme kaydı yok.",
      ),
    ).toBeVisible();
    expect(within(movementRegion).getAllByRole("row")).toHaveLength(2);
  });

  it("labels tax obligations separately and keeps their source period visible", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ...weeklyReport,
        dueItems: [
          {
            direction: "outflow",
            dueOn: "2026-09-18",
            id: "tax-payment-1",
            kind: "tax_payment",
            label: "Geçici vergi",
            remainingAmount: "80.0000",
            settledAmount: "0.0000",
            sourceLabel: "2026-08",
            status: "planned",
            totalAmount: "80.0000",
          },
        ],
      }),
    );

    render(<CashFlowWorkspace />);

    const movementRegion = await screen.findByRole("region", {
      name: "Vade planı tablosu",
    });
    expect(within(movementRegion).getByText("Geçici vergi")).toBeVisible();
    expect(within(movementRegion).getByText("Vergi · 2026-08")).toBeVisible();
    expect(within(movementRegion).getByText("Ödenecek")).toBeVisible();
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
