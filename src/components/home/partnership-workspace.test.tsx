import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PartnershipWorkspace } from "./partnership-workspace";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const partnershipProject = {
  displayName: "7 Emlak Ajansı",
  id: "20000000-0000-4000-8000-000000000001",
  projectType: "partnership",
  shortCode: "7EMLAK",
  status: "active",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PartnershipWorkspace", () => {
  it("shows only partnership projects and explains the separate ledgers", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/projects") return response({ projects: [partnershipProject, { ...partnershipProject, id: "product", projectType: "product", displayName: "ByPusula" }] });
      if (url.endsWith("/commissions")) return response({ commissions: [] });
      if (url.endsWith("/contributions")) return response({ contributions: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<PartnershipWorkspace />);

    expect(await screen.findByRole("heading", { name: "Komisyon payları" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "7 Emlak Ajansı · 7EMLAK" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /ByPusula/u })).not.toBeInTheDocument();
    expect(screen.getByText(/giderlerden ve vergiden ayrı izlenir/iu)).toBeInTheDocument();
  });

  it("creates a commission without trusting the browser for rate or share", async () => {
    const operationKey = "30000000-0000-4000-8000-000000000001";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(operationKey);
    let posted: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects") return response({ projects: [partnershipProject] });
      if (url.endsWith("/commissions") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response({ created: true, commission: {
          ...posted,
          id: "commission-1",
          projectName: partnershipProject.displayName,
          projectShortCode: partnershipProject.shortCode,
          shareAmount: "50000.0000",
          shareRate: "0.5000",
          version: 1,
        } }, 201);
      }
      if (url.endsWith("/commissions")) return response({ commissions: [] });
      if (url.endsWith("/contributions")) return response({ contributions: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();

    render(<PartnershipWorkspace />);
    await screen.findByText("Bu kapsamda komisyon kaydı yok.");
    await user.click(screen.getByRole("button", { name: "+ Komisyon ekle" }));
    await user.type(screen.getByLabelText("İşlem / taşınmaz açıklaması"), "Merkez konut satışı");
    await user.clear(screen.getByLabelText("Paylaşım esas komisyonu (₺)"));
    await user.type(screen.getByLabelText("Paylaşım esas komisyonu (₺)"), "100000");
    await user.selectOptions(screen.getByLabelText("İşlemi kim getirdi?"), "user_both");
    expect(screen.getByText("₺50.000,00 net pay")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Komisyonu kaydet" }));

    await waitFor(() => expect(posted).toMatchObject({
      clientOperationKey: operationKey,
      commissionBasisAmount: "100000",
      contributionMode: "user_both",
      projectId: partnershipProject.id,
    }));
    expect(posted).not.toHaveProperty("shareAmount");
    expect(posted).not.toHaveProperty("shareRate");
  });

  it("defaults the monthly contribution to 7000 TRY and posts it separately", async () => {
    let posted: Record<string, unknown> | undefined;
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("30000000-0000-4000-8000-000000000001");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects") return response({ projects: [partnershipProject] });
      if (url.endsWith("/commissions")) return response({ commissions: [] });
      if (url.endsWith("/contributions") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response({ created: true, contribution: {
          ...posted,
          id: "contribution-1",
          projectName: partnershipProject.displayName,
          projectShortCode: partnershipProject.shortCode,
          receivedAmount: "0.0000",
          receivedOn: null,
          status: "expected",
          version: 1,
        } }, 201);
      }
      if (url.endsWith("/contributions")) return response({ contributions: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();

    render(<PartnershipWorkspace />);
    await screen.findByText("Bu kapsamda katkı kaydı yok.");
    await user.click(screen.getByRole("button", { name: "+ Katkı ekle" }));
    expect(screen.getByLabelText("Beklenen katkı (₺)")).toHaveValue("7000");
    expect(screen.getByLabelText("Durum")).toBeDisabled();
    expect(screen.queryByRole("option", { name: "İptal" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Katkıyı kaydet" }));

    await waitFor(() => expect(posted).toMatchObject({
      description: "Ofis kirası ortak katkısı",
      expectedAmount: "7000",
      projectId: partnershipProject.id,
      status: "expected",
    }));
    expect(posted).not.toHaveProperty("receivedAmount");
    expect(posted).not.toHaveProperty("receivedOn");
    expect(String(posted?.contributionMonth)).toMatch(/^\d{4}-\d{2}$/u);
  });

  it("adds a partial receipt without overwriting contribution history", async () => {
    const contribution = {
      clientOperationKey: "30000000-0000-4000-8000-000000000001",
      contributionMonth: "2026-09",
      description: "Ofis kirası ortak katkısı",
      dueOn: "2026-09-15",
      expectedAmount: "7000.0000",
      id: "contribution-1",
      note: null,
      projectId: partnershipProject.id,
      projectName: partnershipProject.displayName,
      projectShortCode: partnershipProject.shortCode,
      receivedAmount: "2000.0000",
      receivedOn: "2026-09-10",
      receipts: [{
        amount: "2000.0000",
        contributionId: "contribution-1",
        id: "receipt-1",
        note: null,
        receivedOn: "2026-09-10",
      }],
      status: "partial",
      version: 2,
    };
    let posted: Record<string, unknown> | undefined;
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("50000000-0000-4000-8000-000000000001");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects") return response({ projects: [partnershipProject] });
      if (url.endsWith("/commissions")) return response({ commissions: [] });
      if (url.endsWith("/contributions")) return response({ contributions: [contribution] });
      if (url.endsWith("/contributions/contribution-1/receipts") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response({
          contribution: { ...contribution, receivedAmount: "5000.0000", receivedOn: "2026-09-16", status: "partial", version: 3 },
          created: true,
          receipt: { amount: "3000.0000", contributionId: contribution.id, id: "receipt-2", note: null, receivedOn: "2026-09-16" },
        }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();

    render(<PartnershipWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Tahsilat ekle" }));
    await user.type(screen.getByLabelText("Tahsil edilen tutar (₺)"), "3000");
    await user.click(screen.getByRole("button", { name: "Tahsilatı kaydet" }));

    await waitFor(() => expect(posted).toMatchObject({
      amount: "3000",
      clientOperationKey: "50000000-0000-4000-8000-000000000001",
      receivedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    }));
    expect(await screen.findByText("₺5.000,00")).toBeInTheDocument();
    expect(screen.getByText(/10 Eyl 2026 · ₺2\.000,00/u)).toBeInTheDocument();
    expect(screen.getByText(/16 Eyl 2026 · ₺3\.000,00/u)).toBeInTheDocument();
  });

  it("does not offer an invalid backwards transition for a paid commission", async () => {
    const paidCommission = {
      agencyCollectedOn: "2026-09-10",
      closedOn: "2026-09-01",
      commissionBasisAmount: "100000.0000",
      contributionMode: "partner_only",
      description: "Konut kiralama",
      id: "commission-paid",
      note: null,
      paidOn: "2026-09-12",
      projectId: partnershipProject.id,
      projectName: partnershipProject.displayName,
      projectShortCode: partnershipProject.shortCode,
      shareAmount: "10000.0000",
      shareRate: "0.1000",
      status: "paid",
      transactionType: "rental",
      version: 3,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/projects") return response({ projects: [partnershipProject] });
      if (url.endsWith("/commissions")) return response({ commissions: [paidCommission] });
      if (url.endsWith("/contributions")) return response({ contributions: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();

    render(<PartnershipWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Düzenle" }));

    const status = screen.getByLabelText("Durum");
    expect(status).toHaveValue("paid");
    expect(status.querySelectorAll("option")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: /Beklenen işlem/u })).not.toBeInTheDocument();
  });
});
