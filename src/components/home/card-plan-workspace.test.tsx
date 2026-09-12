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
  financeTransactionId: null,
  id: "installment-1",
  installmentCount: 3,
  installmentNumber: 1,
  paidOn: null,
  paymentAccountId: null,
  paymentAccountName: null,
  paymentAccountType: null,
  statementMonth: "2026-09",
  status: "planned",
  updatedAtUtc: "2026-09-01 09:00:00.000000",
  version: 1,
};

const paymentAccount = {
  accountType: "bank",
  balanceAmount: "25000.0000",
  displayName: "Ticari hesap",
  id: "70000000-0000-4000-8000-000000000001",
  status: "active",
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

    render(<CardPlanWorkspace canManagePayments={false} canWrite />);

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

    render(<CardPlanWorkspace canManagePayments={false} canWrite />);
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
        if (url === "/api/finance/accounts") {
          return jsonResponse({ accounts: [paymentAccount] });
        }
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments: [installment] });
        }
        if (url === "/api/finance/card-installments/installment-1" && init?.method === "PATCH") {
          patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse({
            installment: {
              ...installment,
              financeTransactionId: "80000000-0000-4000-8000-000000000001",
              paidOn: String(patchBody.paidOn),
              paymentAccountId: paymentAccount.id,
              paymentAccountName: paymentAccount.displayName,
              paymentAccountType: paymentAccount.accountType,
              status: "paid",
              version: 2,
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<CardPlanWorkspace canManagePayments canWrite />);
    await user.click(await screen.findByRole("button", { name: /ödendi işaretle/iu }));
    const paidOn = screen.getByLabelText("Yazılım lisansı 1. taksit ödeme tarihi");
    await user.clear(paidOn);
    await user.type(paidOn, "2026-08-31");
    await user.click(screen.getByRole("button", {
      name: "Yazılım lisansı 1. taksit ödemesini kaydet",
    }));

    await waitFor(() => expect(patchBody).toEqual({
      paidOn: "2026-08-31",
      sourceAccountId: paymentAccount.id,
      status: "paid",
      version: 1,
    }));
    expect(
      await within(
        screen.getByRole("table", { name: "İş kartı taksit planı" }),
      ).findByText("Ödendi"),
    ).toBeInTheDocument();
    expect(screen.getByText("31 Ağu 2026")).toBeInTheDocument();
    expect(screen.getByText(paymentAccount.displayName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plana geri al/iu })).toBeInTheDocument();
  });

  it("groups installments under each card with debt and next-due summaries", async () => {
    const installments = [
      installment,
      {
        ...installment,
        amount: "1000.0000",
        dueOn: "2026-09-10",
        id: "installment-2",
        installmentNumber: 2,
        paidOn: "2026-09-02",
        status: "paid",
      },
      {
        ...installment,
        amount: "500.0000",
        dueOn: "2026-09-01",
        id: "installment-3",
        installmentNumber: 3,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<CardPlanWorkspace canManagePayments={false} canWrite />);

    const group = await screen.findByRole("region", { name: "İş kartı" });
    const cardSummary = group.querySelector(".card-plan-card-summary");
    expect(cardSummary).not.toBeNull();
    expect(within(cardSummary as HTMLElement).getByText("₺5.500,00")).toBeInTheDocument();
    expect(within(cardSummary as HTMLElement).getByText("₺1.000,00")).toBeInTheDocument();
    expect(within(cardSummary as HTMLElement).getByText("₺4.500,00")).toBeInTheDocument();
    expect(within(cardSummary as HTMLElement).getByText("₺500,00")).toBeInTheDocument();
    expect(within(cardSummary as HTMLElement).getByText("20 Eyl 2026")).toBeInTheDocument();
    expect(
      within(group).getByRole("table", { name: "İş kartı taksit planı" }),
    ).toBeInTheDocument();
  });

  it("bulk-pays the exact open card-period snapshot without a partial amount", async () => {
    const second = {
      ...installment,
      amount: "1000.0000",
      id: "installment-2",
      installmentNumber: 2,
      version: 2,
    };
    let bulkBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url === "/api/finance/accounts") {
          return jsonResponse({ accounts: [paymentAccount] });
        }
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments: [installment, second] });
        }
        if (
          url === "/api/finance/card-installments/bulk-pay" &&
          init?.method === "PATCH"
        ) {
          bulkBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          const paidOn = String(bulkBody.paidOn);
          return jsonResponse({
            installments: [
              { ...installment, paidOn, status: "paid", version: 2 },
              { ...second, paidOn, status: "paid", version: 3 },
            ],
            replayed: false,
            updatedCount: 2,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<CardPlanWorkspace canManagePayments canWrite />);
    const bulkTrigger = await screen.findByRole("button", {
      name: "Dönemin açık taksitlerini ödendi olarak işaretle",
    });
    await user.click(bulkTrigger);
    const date = screen.getByLabelText("İş kartı toplu ödeme tarihi");
    await waitFor(() => expect(date).toHaveFocus());
    const bulkForm = screen.getByRole("form", {
      name: "İş kartı açık taksitlerini toplu şekilde ödendi olarak işaretle",
    });
    expect(within(bulkForm).getByText("İş kartı")).toBeVisible();
    expect(within(bulkForm).getByText("2 açık taksit · ₺5.000,00")).toBeVisible();
    await user.click(within(bulkForm).getByRole("button", { name: "Vazgeç" }));
    const returnedTrigger = screen.getByRole("button", {
      name: "Dönemin açık taksitlerini ödendi olarak işaretle",
    });
    await waitFor(() => expect(returnedTrigger).toHaveFocus());

    await user.click(returnedTrigger);
    const reopenedDate = screen.getByLabelText("İş kartı toplu ödeme tarihi");
    await user.clear(reopenedDate);
    await user.type(reopenedDate, "2026-09-03");
    await user.click(screen.getByRole("button", {
      name: "2 taksiti ödendi olarak işaretle",
    }));

    await waitFor(() =>
      expect(bulkBody).toEqual({
        cardId: card.id,
        installments: [
          { id: installment.id, version: 1 },
          { id: second.id, version: 2 },
        ],
        month: expect.stringMatching(/^\d{4}-\d{2}$/u),
        paidOn: "2026-09-03",
        sourceAccountId: paymentAccount.id,
      }),
    );
    expect(
      screen.queryByRole("button", {
        name: "Dönemin açık taksitlerini ödendi olarak işaretle",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/tutar/iu)).not.toBeInTheDocument();
  });

  it("closes a stale bulk editor and requires a safe plan reload after conflict", async () => {
    let planReadCount = 0;
    let bulkWriteCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url === "/api/finance/accounts") {
          return jsonResponse({ accounts: [paymentAccount] });
        }
        if (
          url === "/api/finance/card-installments/bulk-pay" &&
          init?.method === "PATCH"
        ) {
          bulkWriteCount += 1;
          return jsonResponse({ status: "installment_selection_conflict" }, 409);
        }
        if (url.startsWith("/api/finance/card-installments?")) {
          planReadCount += 1;
          return jsonResponse({
            installments:
              planReadCount === 1
                ? [installment]
                : [
                    {
                      ...installment,
                      paidOn: "2026-09-03",
                      status: "paid",
                      version: 2,
                    },
                  ],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<CardPlanWorkspace canManagePayments canWrite />);
    await user.click(
      await screen.findByRole("button", {
        name: "Dönemin açık taksitlerini ödendi olarak işaretle",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "1 taksiti ödendi olarak işaretle",
      }),
    );

    const refresh = await screen.findByRole("button", {
      name: "Güncel planı yükle",
    });
    expect(
      screen.queryByRole("form", {
        name: "İş kartı açık taksitlerini toplu şekilde ödendi olarak işaretle",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Dönemin açık taksitlerini ödendi olarak işaretle",
      }),
    ).not.toBeInTheDocument();
    expect(bulkWriteCount).toBe(1);

    await user.click(refresh);

    await waitFor(() => expect(planReadCount).toBe(2));
    expect(
      await within(
        screen.getByRole("table", { name: "İş kartı taksit planı" }),
      ).findByText("Ödendi"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Güncel planı yükle" }),
    ).not.toBeInTheDocument();
    expect(bulkWriteCount).toBe(1);
  });

  it("keeps all mutation controls out of a read-only card view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/finance/cards") return jsonResponse({ cards: [card] });
        if (url.startsWith("/api/finance/card-installments?")) {
          return jsonResponse({ installments: [installment] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <CardPlanWorkspace canManagePayments={false} canWrite={false} />,
    );
    expect(await screen.findByText("Yazılım lisansı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Kart ekle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ödendi işaretle/iu })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Dönemin açık taksitlerini ödendi olarak işaretle",
      }),
    ).not.toBeInTheDocument();
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

    render(<CardPlanWorkspace canManagePayments={false} canWrite />);
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

    render(<CardPlanWorkspace canManagePayments={false} canWrite />);
    await screen.findByText("Bu dönem için kart ödemesi yok.");
    fireEvent.click(screen.getByRole("button", { name: /Tüm dönemler/iu }));

    expect(await screen.findByRole("heading", { name: "Tüm dönemler" })).toBeInTheDocument();
    await waitFor(() =>
      expect(planUrls).toContain("/api/finance/card-installments?status=open"),
    );
    expect(planUrls.some((url) => url.includes("month=") && url.includes("status="))).toBe(
      false,
    );
    expect(planUrls).not.toContain("/api/finance/card-installments?month=");
  });
});
