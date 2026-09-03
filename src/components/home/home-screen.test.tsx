import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeScreen } from "@/components/home/home-screen";

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
        phone: null,
        projects: [byPusula],
        shortCode: "ROTA",
        status: "active" as const,
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
              id: "10000000-0000-4000-8000-000000000003",
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
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HomeScreen live />);

    const table = await screen.findByRole("table", { name: "Müşteri kayıtları" });
    expect(within(table).getByText("Mühendis Kafası")).toBeInTheDocument();
    expect(within(table).getByText("ByPusula")).toBeInTheDocument();

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
});
