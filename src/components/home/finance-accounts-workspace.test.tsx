import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/navigation/portal-return-path", () => ({
  redirectToPortalLogin: vi.fn(),
}));

import { FinanceAccountsWorkspace } from "@/components/home/finance-accounts-workspace";

const accounts = [
  {
    accountType: "bank",
    balanceAmount: "125000.0000",
    bankName: "Örnek Banka",
    currency: "TRY",
    displayName: "İşletme hesabı",
    id: "10000000-0000-4000-8000-000000000001",
    openingBalanceAmount: "100000.0000",
    status: "active",
    version: 1,
  },
  {
    accountType: "cash",
    balanceAmount: "25000.0000",
    bankName: null,
    currency: "TRY",
    displayName: "Merkez kasa",
    id: "10000000-0000-4000-8000-000000000002",
    openingBalanceAmount: "20000.0000",
    status: "active",
    version: 1,
  },
] as const;

const overview = {
  accounts,
  recentTransactions: [
    {
      amount: "5000.0000",
      currency: "TRY",
      description: "Müşteri tahsilatı",
      id: "20000000-0000-4000-8000-000000000001",
      isReversal: false,
      occurredOn: "2026-09-07",
      reversed: false,
      sourceAccount: null,
      targetAccount: { id: accounts[0].id, name: accounts[0].displayName },
      transactionType: "income",
    },
  ],
  summary: {
    accountCount: 2,
    activeAccountCount: 2,
    bankBalanceAmount: "125000.0000",
    cashBalanceAmount: "25000.0000",
    currency: "TRY",
    totalLiquidBalance: "150000.0000",
  },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("FinanceAccountsWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(overview)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the visual overview but no mutation controls for a read-only member", async () => {
    render(<FinanceAccountsWorkspace canWrite={false} />);
    expect(await screen.findByText("₺150.000,00")).toBeVisible();
    expect(screen.getByText("İşletme hesabı")).toBeVisible();
    expect(screen.getByText("Merkez kasa")).toBeVisible();
    expect(screen.getByText("Müşteri tahsilatı")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Hesap ekle" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Hareket kaydet/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ters kayıt" })).toBeNull();
  });

  it("submits an account transfer with distinct source and target ids", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/finance/account-transactions" && init?.method === "POST") {
        return jsonResponse({
          created: true,
          transaction: { ...overview.recentTransactions[0], transactionType: "transfer" },
        }, 201);
      }
      return jsonResponse(overview);
    });
    render(<FinanceAccountsWorkspace canWrite />);
    await screen.findByText("₺150.000,00");
    fireEvent.click(screen.getByRole("button", { name: /Hareket kaydet/u }));
    const form = screen.getByRole("heading", { name: "Gelir, gider veya transfer" })
      .closest("section");
    expect(form).not.toBeNull();
    fireEvent.change(within(form!).getByLabelText("Hareket türü"), {
      target: { value: "transfer" },
    });
    fireEvent.change(within(form!).getByLabelText("Kaynak hesap"), {
      target: { value: accounts[0].id },
    });
    fireEvent.change(within(form!).getByLabelText("Hedef hesap"), {
      target: { value: accounts[1].id },
    });
    fireEvent.change(within(form!).getByLabelText("Tutar (₺)"), {
      target: { value: "2500,50" },
    });
    fireEvent.change(within(form!).getByLabelText("Açıklama"), {
      target: { value: "Kasaya aktarım" },
    });
    fireEvent.submit(within(form!).getByRole("button", { name: "Hareketi kaydet" }).closest("form")!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === "/api/finance/account-transactions" && init?.method === "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        amount: "2500.50",
        description: "Kasaya aktarım",
        sourceAccountId: accounts[0].id,
        targetAccountId: accounts[1].id,
        transactionType: "transfer",
      });
    });
  });

  it("creates a reasoned reversal instead of deleting a movement", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/reverse") && init?.method === "POST") {
        return jsonResponse({
          created: true,
          transaction: {
            ...overview.recentTransactions[0],
            id: "20000000-0000-4000-8000-000000000002",
            isReversal: true,
          },
        }, 201);
      }
      return jsonResponse(overview);
    });
    render(<FinanceAccountsWorkspace canWrite />);
    await screen.findByText("Müşteri tahsilatı");
    fireEvent.click(screen.getByRole("button", { name: "Ters kayıt" }));
    fireEvent.change(screen.getByLabelText("Düzeltme gerekçesi"), {
      target: { value: "Mükerrer kayıt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ters kaydı oluştur" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input).endsWith("/reverse") && init?.method === "POST",
      );
      expect(call).toBeDefined();
      expect(String(call?.[0])).not.toContain("delete");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        reason: "Mükerrer kayıt",
      });
    });
  });

  it("moves focus into an editor and restores it to the opening control", async () => {
    render(<FinanceAccountsWorkspace canWrite />);
    await screen.findByText("₺150.000,00");
    const opener = screen.getByRole("button", { name: "Hesap ekle" });
    fireEvent.click(opener);
    const heading = screen.getByRole("heading", { name: "Hesap tanımla" });
    await waitFor(() => expect(heading).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps the account operation key when create succeeds but refresh fails", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/finance/accounts" && init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({ account: accounts[0], created: bodies.length === 1 }, bodies.length === 1 ? 201 : 200);
      }
      reads += 1;
      if (reads === 2) throw new Error("refresh failed");
      return jsonResponse(overview);
    });
    render(<FinanceAccountsWorkspace canWrite />);
    await screen.findByText("₺150.000,00");
    fireEvent.click(screen.getByRole("button", { name: "Hesap ekle" }));
    fireEvent.change(screen.getByLabelText("Hesap adı"), {
      target: { value: "Yeni banka" },
    });
    fireEvent.change(screen.getByLabelText(/Banka adı/u), {
      target: { value: "Örnek Banka" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hesabı kaydet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kayıt oluştu, görünüm yenilenemedi",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hesabı kaydet" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.clientOperationKey).toBe(bodies[0]?.clientOperationKey);
  });

  it("keeps the movement operation key when create succeeds but refresh fails", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/finance/account-transactions" && init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({
          created: bodies.length === 1,
          transaction: overview.recentTransactions[0],
        }, bodies.length === 1 ? 201 : 200);
      }
      reads += 1;
      if (reads === 2) throw new Error("refresh failed");
      return jsonResponse(overview);
    });
    render(<FinanceAccountsWorkspace canWrite />);
    await screen.findByText("₺150.000,00");
    fireEvent.click(screen.getByRole("button", { name: /Hareket kaydet/u }));
    fireEvent.change(screen.getByLabelText("Tutar (₺)"), {
      target: { value: "5000" },
    });
    fireEvent.change(screen.getByLabelText("Açıklama"), {
      target: { value: "Müşteri tahsilatı" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hareketi kaydet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kayıt oluştu, görünüm yenilenemedi",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hareketi kaydet" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.clientOperationKey).toBe(bodies[0]?.clientOperationKey);
  });

  it("keeps the reversal operation key when create succeeds but refresh fails", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/reverse") && init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({
          created: bodies.length === 1,
          transaction: {
            ...overview.recentTransactions[0],
            id: "20000000-0000-4000-8000-000000000002",
            isReversal: true,
          },
        }, bodies.length === 1 ? 201 : 200);
      }
      reads += 1;
      if (reads === 2) throw new Error("refresh failed");
      return jsonResponse(overview);
    });
    render(<FinanceAccountsWorkspace canWrite />);
    await screen.findByText("Müşteri tahsilatı");
    fireEvent.click(screen.getByRole("button", { name: "Ters kayıt" }));
    fireEvent.change(screen.getByLabelText("Düzeltme gerekçesi"), {
      target: { value: "Mükerrer kayıt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ters kaydı oluştur" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kayıt oluştu, görünüm yenilenemedi",
    );
    fireEvent.click(screen.getByRole("button", { name: "Ters kaydı oluştur" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.clientOperationKey).toBe(bodies[0]?.clientOperationKey);
  });
});
