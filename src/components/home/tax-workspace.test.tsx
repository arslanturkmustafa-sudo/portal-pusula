import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/navigation/portal-return-path", () => ({
  redirectToPortalLogin: vi.fn(),
}));

import { TaxWorkspace } from "@/components/home/tax-workspace";

const vat = {
  accountantAmount: null,
  carriedVatCreditAmount: "3000.0000",
  closingVatCreditAmount: "0.0000",
  currency: "TRY" as const,
  description: "Ağustos KDV",
  dueOn: "2026-09-28",
  id: "tax-vat-1",
  manualAdjustmentAmount: "-1000.0000",
  note: "Muhasebeci mutabakatı",
  paidOn: null,
  payableAmount: "14000.0000",
  periodMonth: "2026-09",
  status: "planned" as const,
  systemInputVatAmount: "6000.0000",
  systemNetVatAmount: "18000.0000",
  systemOutputVatAmount: "24000.0000",
  taxType: "vat" as const,
  version: 1,
};

const incomeTax = {
  ...vat,
  accountantAmount: "8500.0000",
  carriedVatCreditAmount: "0.0000",
  description: "Gelir vergisi bildirimi",
  dueOn: "2026-09-30",
  id: "tax-income-1",
  manualAdjustmentAmount: "0.0000",
  payableAmount: "8500.0000",
  systemInputVatAmount: "0.0000",
  systemNetVatAmount: "0.0000",
  systemOutputVatAmount: "0.0000",
  taxType: "income_tax" as const,
};

const taxPayload = {
  selectedPeriodMonth: "2026-09",
  summary: {
    closingVatCreditAmount: "0.0000",
    currency: "TRY" as const,
    overdueAmount: "0.0000",
    paidAmount: "0.0000",
    plannedAmount: "22500.0000",
  },
  taxes: [vat, incomeTax],
  vatEstimate: {
    basis: "active_period_records",
    periodMonth: "2026-09",
    sourceExpenseCount: 4,
    sourceReceivableCount: 3,
    systemInputVatAmount: "6000.0000",
    systemNetVatAmount: "18000.0000",
    systemOutputVatAmount: "24000.0000",
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TaxWorkspace", () => {
  it("defensively ignores records outside the selected period", async () => {
    const staleVat = {
      ...vat,
      carriedVatCreditAmount: "0.0000",
      description: "Temmuz KDV",
      id: "tax-vat-old",
      manualAdjustmentAmount: "0.0000",
      periodMonth: "2026-07",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ ...taxPayload, taxes: [staleVat, ...taxPayload.taxes] }),
      ),
    );

    render(<TaxWorkspace canWrite={false} />);

    expect(await screen.findByText("Ağustos KDV")).toBeInTheDocument();
    expect(screen.queryByText("Temmuz KDV")).not.toBeInTheDocument();
    expect(screen.getAllByText(/14\.000,00/u)).toHaveLength(2);
  });

  it("shows the system VAT reconciliation and hides mutations from read-only users", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse(taxPayload)));

    render(<TaxWorkspace canWrite={false} />);

    expect(await screen.findByText("Ağustos KDV")).toBeInTheDocument();
    expect(screen.getByText("Hesaplanan satış KDV’si")).toBeInTheDocument();
    expect(screen.getByText("İndirilecek gider KDV’si")).toBeInTheDocument();
    expect(screen.getByText("Manuel düzeltme")).toBeInTheDocument();
    expect(screen.getByText("Sonraki döneme alacak")).toBeInTheDocument();
    expect(screen.getByText("Gelir vergisi bildirimi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yeni vergi kaydı" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /kaydını düzenle/u })).not.toBeInTheDocument();
  });

  it("marks a planned obligation paid with the complete versioned payload", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (init?.method === "PATCH") {
          requests.push({
            body: JSON.parse(String(init.body)) as unknown,
            method: init.method,
            url,
          });
          return jsonResponse({ tax: { ...incomeTax, paidOn: "2026-09-08", status: "paid" } });
        }
        return jsonResponse(taxPayload);
      }),
    );

    const user = userEvent.setup();
    render(<TaxWorkspace canWrite />);

    await user.click(
      await screen.findByRole("button", {
        name: "Gelir vergisi bildirimi kaydını ödendi olarak işaretle",
      }),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      body: {
        accountantAmount: "8500.0000",
        paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
        status: "paid",
        taxType: "income_tax",
        version: 1,
        voidReason: null,
      },
      method: "PATCH",
      url: "/api/finance/taxes/tax-income-1",
    });
  });
});
