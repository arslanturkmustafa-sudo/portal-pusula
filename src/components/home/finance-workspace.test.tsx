import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FinanceWorkspace } from "@/components/home/finance-workspace";

const customers = [
  { id: "sample-1", name: "Atlas Makina" },
  { id: "sample-2", name: "Vega Endüstri" },
] as const;

const accounts = [
  {
    accountType: "bank" as const,
    bankName: "Örnek Banka",
    displayName: "Ana TL Hesabı",
    id: "60000000-0000-4000-8000-000000000001",
    status: "active" as const,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

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

  it("explains that a generated receivable is due in the month after service", async () => {
    const user = userEvent.setup();
    render(<FinanceWorkspace customers={customers} live={false} />);

    await user.click(screen.getByRole("button", { name: "Ayı oluştur" }));

    expect(screen.getByLabelText("Hizmet ayı")).toBeInTheDocument();
    expect(
      screen.getByText(/vade, sözleşmedeki ödeme gününe göre izleyen ayda oluşur/u),
    ).toBeInTheDocument();
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
      "İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.",
    );
    await user.click(submit);
    await screen.findByText("Kayıt tamamlandı; alacak tablosu güncellendi.");

    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[0]?.clientOperationKey).toBe(operationKey);
    expect(postBodies[1]?.clientOperationKey).toBe(operationKey);
  });

  it("posts the selected destination account with a collection", async () => {
    const postedBodies: Array<Record<string, unknown>> = [];
    const receivablePayload = {
      receivables: [{
        collectedAmount: "0.0000",
        collections: [],
        contractId: null,
        createdAtUtc: "2026-09-01T08:00:00.000Z",
        customerId: "sample-1",
        customerName: "Atlas Makina",
        description: "Eylül danışmanlığı",
        dueOn: "2026-09-10",
        id: "30000000-0000-4000-8000-000000000001",
        netAmount: "1000.0000",
        outstandingAmount: "1000.0000",
        periodMonth: "2026-09",
        projectId: null,
        projectName: null,
        projectShortCode: null,
        recordState: "active",
        sourceType: "opening_balance",
        status: "open",
        totalAmount: "1000.0000",
        vatAmount: "0.0000",
        version: 1,
      }],
      summary: {
        collectedThisMonth: "0.0000",
        dueThisMonth: "1000.0000",
        overdue: "0.0000",
        outstanding: "1000.0000",
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        postedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({ created: true });
      }
      return jsonResponse(receivablePayload);
    }));
    const user = userEvent.setup();

    render(
      <FinanceWorkspace accounts={accounts} customers={customers} live />,
    );
    const collectionButton = await screen.findByRole("button", {
      name: "Tahsilat gir",
    });
    await waitFor(() => expect(collectionButton).toBeEnabled());
    await user.click(collectionButton);
    await user.selectOptions(
      screen.getByLabelText("Alacak kaydı"),
      "30000000-0000-4000-8000-000000000001",
    );
    await user.type(screen.getByLabelText("Tahsil edilen tutar"), "250");
    await user.selectOptions(
      screen.getByLabelText("Tahsilatın geldiği kasa / banka hesabı"),
      accounts[0].id,
    );
    await user.click(screen.getByRole("button", { name: "Tahsilatı işle" }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toMatchObject({
      amount: "250",
      receivableId: "30000000-0000-4000-8000-000000000001",
      targetAccountId: accounts[0].id,
    });
  });

  it("offers collection reversal only for an unreversed original movement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({
        receivables: [{
          collectedAmount: "300.0000",
          collections: [
            {
              amount: "100.0000",
              collectedOn: "2026-09-01",
              entryType: "collection",
              id: "collection-open",
              reasonSummary: null,
              receivableId: "receivable-1",
              reversalOfId: null,
              reversed: false,
            },
            {
              amount: "100.0000",
              collectedOn: "2026-09-02",
              entryType: "collection",
              id: "collection-reversed",
              reasonSummary: null,
              receivableId: "receivable-1",
              reversalOfId: null,
              reversed: true,
            },
            {
              amount: "-100.0000",
              collectedOn: "2026-09-03",
              entryType: "reversal",
              id: "reversal-1",
              reasonSummary: "Mükerrer tahsilat",
              receivableId: "receivable-1",
              reversalOfId: "collection-reversed",
              reversed: false,
            },
          ],
          contractId: null,
          createdAtUtc: "2026-09-01T08:00:00.000Z",
          customerId: "sample-1",
          customerName: "Atlas Makina",
          description: "Eylül danışmanlığı",
          dueOn: "2026-09-10",
          id: "receivable-1",
          netAmount: "1000.0000",
          outstandingAmount: "700.0000",
          periodMonth: "2026-09",
          projectId: null,
          projectName: null,
          projectShortCode: null,
          recordState: "active",
          sourceType: "opening_balance",
          status: "partial",
          totalAmount: "1000.0000",
          vatAmount: "0.0000",
          version: 2,
        }],
        summary: {
          collectedThisMonth: "300.0000",
          dueThisMonth: "1000.0000",
          overdue: "0.0000",
          outstanding: "700.0000",
        },
      })),
    );

    render(<FinanceWorkspace customers={customers} live />);

    expect(await screen.findAllByText("Tahsilatı ters kaydet")).toHaveLength(1);
  });
});
