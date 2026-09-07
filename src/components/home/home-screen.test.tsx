import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeScreen } from "@/components/home/home-screen";

function istanbulToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeScreen", () => {
  it("renders the focused customer workspace without unrelated modules", () => {
    render(<HomeScreen />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Müşteriler");
    expect(screen.getByRole("button", { name: "Müşteri ekle" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Müşteri ara" })).toBeInTheDocument();

    expect(screen.getByRole("region", { name: "Müşteri kayıtları" })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Müşteri kayıtları" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByText("Atlas Makina")).toBeInTheDocument();
    expect(within(table).getByText("İzleyen ayın 5. günü")).toBeInTheDocument();
    expect(within(table).getAllByText("Gecikti")).toHaveLength(2);

    expect(screen.queryByText("Yerel tasarım önizlemesi")).not.toBeInTheDocument();
    expect(screen.queryByText(/İşlerinizi tek bir yerde/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hesabım" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bugünün planı" })).not.toBeInTheDocument();
  });

  it("never presents sample customers as live records while data is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<HomeScreen live />);

    expect(screen.getByText("Müşteri kayıtları yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByText("Atlas Makina")).not.toBeInTheDocument();
    expect(screen.getByText("Henüz müşteri kaydı yok. İlk müşteriyi ekleyerek başlayın.")).toBeInTheDocument();
  });

  it("opens date-based contract and monthly visit planning from a customer row", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /Atlas Makina/ }));

    expect(
      screen.getByRole("region", { name: "Atlas Makina" }),
    ).toBeInTheDocument();
    const startsOn = screen.getByLabelText("Başlangıç") as HTMLInputElement;
    const endsOn = screen.getByLabelText("Bitiş") as HTMLInputElement;
    expect(startsOn.value).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(endsOn.value).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(endsOn.value > startsOn.value).toBe(true);
    expect(screen.getByText("₺60.000,00")).toBeInTheDocument();
    expect(screen.queryByLabelText(/haftalık gün/iu)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ziyaret adedi/iu)).not.toBeInTheDocument();
    expect(screen.getByText("Önce sözleşmeyi kaydedin.")).toBeInTheDocument();
  });

  it("shows, searches and filters customer projects and requires one on create", async () => {
    const muhendisKafasi = {
      displayName: "Mühendis Kafası",
      id: "40000000-0000-4000-8000-000000000001",
      shortCode: "MUHENDIS_KAFASI",
      status: "active" as const,
    };
    const byPusula = {
      displayName: "ByPusula",
      id: "40000000-0000-4000-8000-000000000002",
      shortCode: "BYPUSULA",
      status: "planned" as const,
    };
    const optiPusula = {
      displayName: "OptiPusula",
      id: "40000000-0000-4000-8000-000000000003",
      shortCode: "OPTIPUSULA",
      status: "on_hold" as const,
    };
    const completedProject = {
      displayName: "Tamamlanan İç Proje",
      id: "40000000-0000-4000-8000-000000000004",
      shortCode: "TAMAMLANAN",
      status: "completed" as const,
    };
    const customers = [
      {
        contactNote: null,
        displayName: "Zevahir Home",
        email: null,
        id: "10000000-0000-4000-8000-000000000001",
        overview: { nextVisitOn: istanbulToday() },
        phone: null,
        projects: [muhendisKafasi],
        shortCode: "ZEVAHIR",
        status: "active" as const,
      },
      {
        contactNote: null,
        displayName: "Rota Teknoloji",
        email: null,
        id: "10000000-0000-4000-8000-000000000002",
        overview: { nextVisitOn: null },
        phone: null,
        projects: [byPusula],
        shortCode: "ROTA",
        status: "active" as const,
      },
      {
        archivedAtUtc: "2026-09-01 08:00:00.000000",
        contactNote: null,
        displayName: "Arşiv Lojistik",
        email: null,
        id: "10000000-0000-4000-8000-000000000003",
        overview: { nextVisitOn: istanbulToday() },
        phone: null,
        projects: [muhendisKafasi],
        shortCode: "ARSIV",
        status: "inactive" as const,
      },
    ];
    let postBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/customers" && init?.method === "POST") {
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            customer: {
              ...customers[0],
              displayName: postBody.displayName,
              id: "10000000-0000-4000-8000-000000000004",
              projects: [muhendisKafasi],
              shortCode: postBody.shortCode,
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 201 },
        );
      }
      if (url.endsWith("/contracts")) {
        return new Response(JSON.stringify({ contracts: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/customers") {
        return new Response(JSON.stringify({ customers }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/projects") {
        return new Response(
          JSON.stringify({
            projects: [
              muhendisKafasi,
              byPusula,
              optiPusula,
              completedProject,
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/finance/receivables") {
        return new Response(
          JSON.stringify({
            receivables: [
              {
                customerId: customers[0].id,
                status: "overdue",
              },
              {
                customerId: customers[2].id,
                status: "overdue",
              },
            ],
            summary: {
              dueThisMonth: "25000.0000",
              outstanding: "900719925474099.1249",
              overdue: "35000.0000",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HomeScreen live />);

    const table = await screen.findByRole("table", { name: "Müşteri kayıtları" });
    const summary = screen.getByRole("region", { name: "Müşteri özeti" });
    expect(within(summary).getByText("Aktif müşteri").parentElement).toHaveTextContent(
      "02",
    );
    expect(
      within(summary).getByText("Bugün ziyaretli aktif müşteri").parentElement,
    ).toHaveTextContent("01");
    expect(screen.getByText("₺35.000,00")).toBeInTheDocument();
    expect(screen.getByText("₺900.719.925.474.099,12")).toBeInTheDocument();
    expect(within(table).getAllByText("Mühendis Kafası")).toHaveLength(2);
    expect(within(table).getByText("ByPusula")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Geciken/u }));
    expect(within(table).getByText("Zevahir Home")).toBeInTheDocument();
    expect(within(table).getByText("Arşiv Lojistik")).toBeInTheDocument();
    expect(within(table).getByText("Pasif · gecikmiş ödeme")).toBeInTheDocument();
    expect(within(table).queryByText("Rota Teknoloji")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tümü" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Projeye göre filtrele" }),
      byPusula.id,
    );
    expect(within(table).getByText("Rota Teknoloji")).toBeInTheDocument();
    expect(within(table).queryByText("Zevahir Home")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Projeye göre filtrele" }),
      "all",
    );
    await user.type(screen.getByRole("searchbox", { name: "Müşteri ara" }), "BYPUSULA");
    expect(within(table).getByText("Rota Teknoloji")).toBeInTheDocument();
    expect(within(table).queryByText("Zevahir Home")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Müşteri ekle" }));
    expect(
      screen.getByRole("checkbox", { name: /ByPusula/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /OptiPusula/u }),
    ).toBeInTheDocument();
    expect(screen.getByText("BYPUSULA · planlandı")).toBeInTheDocument();
    expect(screen.getByText("OPTIPUSULA · beklemede")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Tamamlanan İç Proje/u }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Müşteri / şirket adı"), "Yeni Müşteri");
    await user.click(screen.getByRole("button", { name: "Müşteriyi kaydet" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Müşteriyi en az bir projeye bağlayın.",
    );

    await user.click(screen.getByRole("checkbox", { name: /Mühendis Kafası/u }));
    await user.click(screen.getByRole("button", { name: "Müşteriyi kaydet" }));
    await waitFor(() =>
      expect(postBody).toEqual(
        expect.objectContaining({ projectIds: [muhendisKafasi.id] }),
      ),
    );
  });

  it("keeps payment state unknown and disables the overdue filter when finance data fails", async () => {
    const customer = {
      contactNote: null,
      displayName: "Zevahir Home",
      email: null,
      id: "10000000-0000-4000-8000-000000000001",
      overview: { nextVisitOn: null },
      phone: null,
      projects: [],
      shortCode: "ZEVAHIR",
      status: "active" as const,
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/customers") {
        return new Response(JSON.stringify({ customers: [customer] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/finance/receivables") {
        return new Response(JSON.stringify({ status: "service_unavailable" }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HomeScreen
        capabilities={{
          canLifecycleContracts: false,
          canLifecycleCustomers: false,
          canOpenCustomerDetails: false,
          canReadAudit: false,
          canReadBilling: false,
          canReadProjects: false,
          canReadReceivables: true,
          canReadVisits: true,
          canWriteCustomers: false,
        }}
        live
      />,
    );

    expect(
      await screen.findByText("Aktif · ödeme durumu bilinmiyor"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Geciken" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ödeme durumları alınamadı",
    );
    expect(screen.queryByText("Gecikmiş ödeme")).not.toBeInTheDocument();
  });

  it("does not request or infer receivable data without finance permission", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url !== "/api/customers") {
        throw new Error(`Unexpected request: ${url}`);
      }
      return new Response(
        JSON.stringify({
          customers: [
            {
              contactNote: null,
              displayName: "Yetki Sınırlı Firma",
              email: null,
              id: "10000000-0000-4000-8000-000000000002",
              overview: { nextVisitOn: null },
              phone: null,
              projects: [],
              shortCode: "SINIRLI",
              status: "active",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HomeScreen
        capabilities={{
          canLifecycleContracts: false,
          canLifecycleCustomers: false,
          canOpenCustomerDetails: false,
          canReadAudit: false,
          canReadBilling: false,
          canReadProjects: false,
          canReadReceivables: false,
          canReadVisits: false,
          canWriteCustomers: false,
        }}
        live
      />,
    );

    expect(
      await screen.findByText("Aktif · ödeme durumu bilinmiyor"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Geciken" })).toBeDisabled();
    expect(screen.getAllByText("Kısıtlı")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ödeme durumları alınamadı")).not.toBeInTheDocument();
  });
});
