import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FinanceWorkspace } from "@/components/home/finance-workspace";

const customers = [
  { id: "sample-1", name: "Atlas Makina" },
  { id: "sample-2", name: "Vega Endüstri" },
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FinanceWorkspace", () => {
  it("shows the receivable summary, ledger and three focused actions", async () => {
    const user = userEvent.setup();
    render(<FinanceWorkspace customers={customers} live={false} />);

    const summary = screen.getByRole("region", { name: "Alacak özeti" });
    for (const label of [
      "Toplam açık",
      "Geciken",
      "Bu ay beklenen",
      "Bu ay tahsil edilen",
    ]) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }

    const ledger = screen.getByRole("table", {
      name: "Alacak ve tahsilat kayıtları",
    });
    expect(within(ledger).getAllByRole("row")).toHaveLength(4);
    expect(within(ledger).getByText("Atlas Makina")).toBeInTheDocument();
    expect(within(ledger).getByText("Kısmi tahsilat")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Ayı oluştur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Geçmiş alacak ekle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tahsilat gir" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Geçmiş alacak ekle" }));
    expect(
      screen.getByRole("heading", { name: "Geçmiş alacak ekle" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Net tutar")).toBeInTheDocument();
    expect(screen.getByLabelText("KDV tutarı")).toHaveValue(0);
  });

  it("does not present sample money while live records are loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<FinanceWorkspace customers={[]} live />);

    expect(screen.getByText("Alacak kayıtları yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByText("Atlas Makina")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Tahsilat gir" })).toBeDisabled();
  });

  it("reuses the same client operation key when an opening-balance retry follows a network failure", async () => {
    const operationKey = "40000000-0000-4000-8000-000000000001";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(operationKey);
    const postBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          postBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          if (postBodies.length === 1) throw new TypeError("network lost");
        }
        return {
          json: async () => ({ receivables: [], summary: {} }),
          ok: true,
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<FinanceWorkspace customers={customers} live />);
    await screen.findByText(
      "Henüz alacak kaydı yok. Ayı oluşturarak veya geçmiş alacak ekleyerek başlayın.",
    );
    await user.click(screen.getByRole("button", { name: "Geçmiş alacak ekle" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Müşteri" }), "sample-1");
    await user.type(screen.getByLabelText("Net tutar"), "100");
    const submit = screen.getByRole("button", { name: "Geçmiş alacağı kaydet" });

    await user.click(submit);
    await screen.findByText(
      "İşlem tamamlanamadı. Alanları ve bağlantıyı kontrol edin.",
    );
    await user.click(submit);
    await screen.findByText("Kayıt tamamlandı; alacak tablosu güncellendi.");

    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[0]?.clientOperationKey).toBe(operationKey);
    expect(postBodies[1]?.clientOperationKey).toBe(operationKey);
  });
});
