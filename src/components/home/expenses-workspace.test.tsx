import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpensesWorkspace } from "@/components/home/expenses-workspace";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const project = {
  displayName: "7 Emlak Ajansı",
  id: "project-1",
  shortCode: "7_EMLAK",
  status: "active",
};

const card = {
  bankName: "Örnek Banka",
  creditLimitAmount: "150000.0000",
  displayName: "İş kartı",
  id: "card-1",
  lastFour: "1234",
  note: null,
  paymentDueDay: 20,
  statementClosingDay: 10,
  status: "active",
  version: 1,
};

const inactiveCard = { ...card, status: "inactive" as const };

const expense = {
  category: "rent",
  creditCardId: null,
  creditCardName: null,
  description: "Ofis kirası",
  documentNumber: null,
  documentType: "invoice",
  id: "expense-1",
  incurredOn: "2026-09-01",
  installmentCount: 1,
  netAmount: "13750.0000",
  note: null,
  paymentMethod: "bank_transfer",
  projectId: project.id,
  projectName: project.displayName,
  projectShortCode: project.shortCode,
  status: "active",
  totalAmount: "16500.0000",
  vatAmount: "2750.0000",
  vendorName: "Ofis sahibi",
  version: 1,
  voidReason: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ExpensesWorkspace", () => {
  it("loads projects, cards and expenses sequentially without showing sample data", async () => {
    const requestOrder: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        requestOrder.push(url);
        if (url === "/api/projects") return jsonResponse({ projects: [project] });
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url === "/api/finance/expenses") return jsonResponse({ expenses: [expense], summary: {} });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<ExpensesWorkspace />);

    expect(screen.getByText("Gider kayıtları yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByText("Atlas Makina")).not.toBeInTheDocument();
    expect(await screen.findByText("Ofis kirası")).toBeInTheDocument();
    expect(requestOrder).toEqual([
      "/api/projects",
      "/api/finance/cards",
      "/api/finance/expenses",
    ]);
    expect(screen.getAllByText("₺16.500,00").length).toBeGreaterThan(0);
  });

  it("creates a project-linked card expense and sends the selected installment count", async () => {
    const operationKey = "40000000-0000-4000-8000-000000000001";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(operationKey);
    let postBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse({ projects: [project] });
      if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
      if (url === "/api/finance/expenses" && init?.method === "POST") {
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          created: true,
          expense: {
            ...expense,
            category: "software_subscription",
            creditCardId: card.id,
            creditCardName: card.displayName,
            description: "Yazılım lisansı",
            id: "expense-2",
            installmentCount: 3,
            netAmount: "1000.0000",
            paymentMethod: "credit_card",
            totalAmount: "1200.0000",
            vatAmount: "200.0000",
          },
        }, 201);
      }
      if (url === "/api/finance/expenses") return jsonResponse({ expenses: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ExpensesWorkspace />);
    await screen.findByText("Henüz gider yok. İlk kaydı ekleyerek başlayın.");
    await user.click(screen.getByRole("button", { name: "+ Gider ekle" }));
    await user.selectOptions(screen.getByLabelText("Proje / iş hattı"), project.id);
    await user.selectOptions(screen.getByLabelText("Kategori"), "software_subscription");
    await user.type(screen.getByLabelText("Açıklama"), "Yazılım lisansı");
    await user.type(screen.getByLabelText("Net tutar (₺)"), "1000");
    await user.clear(screen.getByLabelText("KDV tutarı (₺)"));
    await user.type(screen.getByLabelText("KDV tutarı (₺)"), "200");
    await user.selectOptions(screen.getByLabelText("Ödeme yöntemi"), "credit_card");
    await user.selectOptions(screen.getByLabelText("Kredi kartı"), card.id);
    await user.clear(screen.getByLabelText("Taksit sayısı"));
    await user.type(screen.getByLabelText("Taksit sayısı"), "3");
    await user.click(screen.getByRole("button", { name: "Gideri kaydet" }));

    await waitFor(() => expect(postBody).toEqual(expect.objectContaining({
      category: "software_subscription",
      clientOperationKey: operationKey,
      creditCardId: card.id,
      description: "Yazılım lisansı",
      installmentCount: 3,
      netAmount: "1000",
      paymentMethod: "credit_card",
      projectId: project.id,
      vatAmount: "200",
    })));
    expect(await screen.findByText("Yazılım lisansı")).toBeInTheDocument();
    expect(screen.getByText("3 taksit", { exact: false })).toBeInTheDocument();
  });

  it("opens editable and copy forms from an existing expense", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/projects") return jsonResponse({ projects: [project] });
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url === "/api/finance/expenses") return jsonResponse({ expenses: [expense] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<ExpensesWorkspace />);

    await screen.findByText("Ofis kirası");
    await user.click(screen.getByRole("button", { name: "Ofis kirası giderini düzenle" }));
    expect(screen.getByRole("heading", { name: "Gideri düzenle" })).toHaveFocus();
    expect(screen.getByLabelText("Net tutar (₺)")).toHaveValue("13750");
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    await user.click(screen.getByRole("button", { name: "Ofis kirası giderini kopyala" }));
    expect(screen.getByRole("heading", { name: "Gider kopyası" })).toBeInTheDocument();
    expect(screen.getByLabelText("Açıklama")).toHaveValue("Ofis kirası");
  });

  it("keeps a linked inactive card only while editing the existing expense", async () => {
    const cardExpense = {
      ...expense,
      creditCardId: inactiveCard.id,
      creditCardName: inactiveCard.displayName,
      paymentMethod: "credit_card" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/projects") return jsonResponse({ projects: [project] });
        if (url === "/api/finance/cards") return jsonResponse({ cards: [inactiveCard] });
        if (url === "/api/finance/expenses") return jsonResponse({ expenses: [cardExpense] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<ExpensesWorkspace />);

    await screen.findByText("Ofis kirası");
    await user.click(screen.getByRole("button", { name: "Ofis kirası giderini düzenle" }));
    expect(screen.getByLabelText("Kredi kartı")).toHaveValue(inactiveCard.id);
    expect(screen.getByRole("option", { name: "İş kartı (pasif)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    await user.click(screen.getByRole("button", { name: "Ofis kirası giderini kopyala" }));
    expect(screen.getByLabelText("Kredi kartı")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "İş kartı (pasif)" })).not.toBeInTheDocument();
  });
});
