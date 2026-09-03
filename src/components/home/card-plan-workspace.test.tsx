import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardPlanWorkspace } from "@/components/home/card-plan-workspace";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

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

const installment = {
  amount: "4000.0000",
  createdAtUtc: "2026-09-01 09:00:00.000000",
  creditCardId: card.id,
  creditCardName: card.displayName,
  dueOn: "2026-09-20",
  expenseDescription: "Yazılım lisansı",
  expenseId: "expense-1",
  id: "installment-1",
  installmentCount: 3,
  installmentNumber: 1,
  paidOn: null,
  statementMonth: "2026-09",
  status: "planned",
  updatedAtUtc: "2026-09-01 09:00:00.000000",
  version: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CardPlanWorkspace", () => {
  it("loads cards before the payment plan and never asks for PAN or CVV", async () => {
    const requestOrder: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        requestOrder.push(url);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments: [installment], summary: {} });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<CardPlanWorkspace />);

    expect(await screen.findByText("Yazılım lisansı")).toBeInTheDocument();
    expect(requestOrder[0]).toBe("/api/finance/cards");
    expect(requestOrder[1]).toMatch(/^\/api\/finance\/card-installments\?month=/u);
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
    expect(screen.queryByLabelText(/tam kart numarası/iu)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cvv/iu)).not.toBeInTheDocument();
  });

  it("creates a card with only the safe identifying fields", async () => {
    const operationKey = "40000000-0000-4000-8000-000000000001";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(operationKey);
    let postBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/finance/cards" && init?.method === "POST") {
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ card, created: true }, 201);
      }
      if (url === "/api/finance/cards") return jsonResponse({ cards: [] });
      if (url.startsWith("/api/finance/card-installments?")) {
        return jsonResponse({ installments: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CardPlanWorkspace />);
    await screen.findByText("Henüz kart tanımlanmadı.");
    await user.click(screen.getByRole("button", { name: "+ Kart ekle" }));
    await user.type(screen.getByLabelText("Kart adı"), "İş kartı");
    await user.type(screen.getByLabelText("Banka"), "Örnek Banka");
    await user.type(screen.getByLabelText("Son dört hane"), "1234");
    await user.clear(screen.getByLabelText("Kart limiti (₺)"));
    await user.type(screen.getByLabelText("Kart limiti (₺)"), "150000");
    await user.click(screen.getByRole("button", { name: "Kartı kaydet" }));

    await waitFor(() => expect(postBody).toEqual({
      bankName: "Örnek Banka",
      clientOperationKey: operationKey,
      creditLimitAmount: "150000",
      displayName: "İş kartı",
      lastFour: "1234",
      note: null,
      paymentDueDay: 20,
      statementClosingDay: 10,
      status: "active",
    }));
    expect(postBody).not.toHaveProperty("cardNumber");
    expect(postBody).not.toHaveProperty("cvv");
    expect((await screen.findAllByText("İş kartı")).length).toBeGreaterThan(0);
  });

  it("marks a planned installment paid with the chosen date and version", async () => {
    let patchBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments: [installment] });
        }
        if (url === "/api/finance/card-installments/installment-1" && init?.method === "PATCH") {
          patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse({
            installment: {
              ...installment,
              paidOn: String(patchBody.paidOn),
              status: "paid",
              version: 2,
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<CardPlanWorkspace />);
    await user.click(await screen.findByRole("button", { name: /ödendi işaretle/iu }));
    const paidOn = screen.getByLabelText("Yazılım lisansı 1. taksit ödeme tarihi");
    await user.clear(paidOn);
    await user.type(paidOn, "2026-08-31");
    await user.click(screen.getByRole("button", {
      name: "Yazılım lisansı 1. taksit ödemesini kaydet",
    }));

    await waitFor(() => expect(patchBody).toEqual({
      paidOn: "2026-08-31",
      status: "paid",
      version: 1,
    }));
    expect(
      await within(
        screen.getByRole("table", { name: "Kart taksit ve ödeme planı" }),
      ).findByText("Ödendi"),
    ).toBeInTheDocument();
    expect(screen.getByText("31 Ağu 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plana geri al/iu })).toBeInTheDocument();
  });

  it("clears stale installments and offers retry when a changed period cannot load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url.includes("month=2027-01")) return jsonResponse({ status: "unavailable" }, 500);
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments: [installment] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<CardPlanWorkspace />);
    expect(await screen.findByText("Yazılım lisansı")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ödeme planı dönemi"), {
      target: { value: "2027-01" },
    });

    expect(await screen.findByRole("button", { name: "Yeniden dene" })).toBeInTheDocument();
    expect(screen.queryByText("Yazılım lisansı")).not.toBeInTheDocument();
    expect(screen.queryByText("Bu dönem için kart ödemesi yok.")).not.toBeInTheDocument();
  });

  it("requests all periods without an empty month query parameter", async () => {
    const planUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url.startsWith("/api/finance/card-installments")) {
          planUrls.push(url);
          return jsonResponse({ installments: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<CardPlanWorkspace />);
    await screen.findByText("Bu dönem için kart ödemesi yok.");
    fireEvent.change(screen.getByLabelText("Ödeme planı dönemi"), {
      target: { value: "" },
    });

    expect(await screen.findByRole("heading", { name: "Tüm dönemler" })).toBeInTheDocument();
    await waitFor(() => expect(planUrls).toContain("/api/finance/card-installments"));
    expect(planUrls).not.toContain("/api/finance/card-installments?month=");
  });
});
