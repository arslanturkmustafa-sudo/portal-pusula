import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerWorkspace } from "@/components/home/customer-workspace";

const customerId = "10000000-0000-4000-8000-000000000001";
const otherCustomerId = "10000000-0000-4000-8000-000000000002";
const contractId = "20000000-0000-4000-8000-000000000001";
const customer = {
  contactNote: "Satın alma ekibiyle görüşülüyor.",
  displayName: "Zevahir Home",
  email: "bilgi@zevahir.example",
  id: customerId,
  name: "Zevahir Home",
  phone: "+90 555 000 00 00",
};
const otherCustomer = {
  contactNote: null,
  displayName: "Kardeşler Grup",
  email: null,
  id: otherCustomerId,
  name: "Kardeşler Grup",
  phone: null,
};
const contract = {
  currency: "TRY" as const,
  customerId,
  endsOn: "2026-12-31",
  id: contractId,
  internalNote: null,
  monthlyFeeAmount: "60000.0000",
  paymentDay: 15,
  startsOn: "2026-02-01",
  status: "active" as const,
  vatMode: "exempt" as const,
  vatRate: "0.00",
};
const nextContractId = "20000000-0000-4000-8000-000000000002";
const nextContract = {
  ...contract,
  endsOn: "2027-12-31",
  id: nextContractId,
  monthlyFeeAmount: "70000.0000",
  paymentDay: 20,
  startsOn: "2027-01-01",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Native input value setter is unavailable.");
  setter.call(input, value);
}

function renderWorkspace(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render(
    <CustomerWorkspace
      customer={customer}
      live
      onContractSaved={vi.fn()}
      onVisitsSaved={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CustomerWorkspace reliable date writes", () => {
  it("updates only changed customer fields and reports the saved customer", async () => {
    const requests: unknown[] = [];
    const onCustomerSaved = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/contracts")) {
        return jsonResponse({ contracts: [contract] });
      }
      if (method === "GET" && url.includes("/month-plans/")) {
        return jsonResponse({ monthPlan: { visits: [] } });
      }
      if (method === "PATCH" && url === `/api/customers/${customerId}`) {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        return jsonResponse({
          customer: { ...customer, ...body, name: undefined },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CustomerWorkspace
        customer={customer}
        live
        onContractSaved={vi.fn()}
        onCustomerSaved={onCustomerSaved}
        onVisitsSaved={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Müşteri bilgilerini düzenle" }),
    );
    const nameInput = screen.getByLabelText("Müşteri / şirket adı");
    await user.clear(nameInput);
    await user.type(nameInput, "Zevahir Home Mobilya");
    await user.click(
      screen.getByRole("button", { name: "Müşteri bilgilerini kaydet" }),
    );

    await waitFor(() => expect(requests).toEqual([
      { displayName: "Zevahir Home Mobilya" },
    ]));
    expect(onCustomerSaved).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Zevahir Home Mobilya" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Zevahir Home Mobilya" }),
    ).toBeInTheDocument();
  });

  it("switches annual periods and creates the following period with POST", async () => {
    const monthPlanUrls: string[] = [];
    const postRequests: Array<{ body: Record<string, unknown>; url: string }> = [];
    const createdContractId = "20000000-0000-4000-8000-000000000003";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/contracts")) {
        return jsonResponse({ contracts: [nextContract, contract] });
      }
      if (method === "GET" && url.includes("/month-plans/")) {
        monthPlanUrls.push(url);
        return jsonResponse({ monthPlan: { visits: [] } });
      }
      if (method === "POST" && url.endsWith("/contracts")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        postRequests.push({ body, url });
        return jsonResponse({
          contract: {
            ...body,
            currency: "TRY",
            customerId,
            id: createdContractId,
          },
        }, 201);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWorkspace(fetchMock);

    await user.click(
      await screen.findByRole("button", { name: /2027-01-01.*70\.000 ₺/u }),
    );
    await waitFor(() =>
      expect(monthPlanUrls).toContain(
        `/api/customers/${customerId}/contracts/${nextContractId}/month-plans/2027-01`,
      ),
    );
    expect(screen.getByLabelText("Aylık ücret")).toHaveValue("70000");

    await user.click(screen.getByRole("button", { name: "+ Yeni dönem ekle" }));
    expect(screen.getByLabelText("Başlangıç")).toHaveValue("2028-01-01");
    expect(screen.getByLabelText("Bitiş")).toHaveValue("2028-12-31");
    await user.click(screen.getByRole("button", { name: "Yeni dönemi kaydet" }));

    await waitFor(() => expect(postRequests).toHaveLength(1));
    expect(postRequests[0]).toMatchObject({
      body: expect.objectContaining({
        endsOn: "2028-12-31",
        monthlyFeeAmount: "70000",
        startsOn: "2028-01-01",
      }),
      url: `/api/customers/${customerId}/contracts`,
    });
    expect(
      await screen.findByRole("button", { name: /2028-01-01.*70\.000 ₺/u }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the backend overlap explanation for a conflicting new period", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/contracts")) {
        return jsonResponse({ contracts: [contract] });
      }
      if (method === "GET" && url.includes("/month-plans/")) {
        return jsonResponse({ monthPlan: { visits: [] } });
      }
      if (method === "POST" && url.endsWith("/contracts")) {
        return jsonResponse({ status: "contract_period_conflict" }, 409);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWorkspace(fetchMock);

    await user.click(
      await screen.findByRole("button", { name: "+ Yeni dönem ekle" }),
    );
    fireEvent.input(screen.getByLabelText("Başlangıç"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.input(screen.getByLabelText("Bitiş"), {
      target: { value: "2026-12-31" },
    });
    await user.click(screen.getByRole("button", { name: "Yeni dönemi kaydet" }));

    expect(
      await screen.findByText(
        "Bu tarih aralığı müşterinin başka bir sözleşmesiyle çakışıyor.",
      ),
    ).toBeInTheDocument();
  });

  it("starts with a clean contract and plan session when the customer changes", async () => {
    const firstVisit = {
      committedOn: "2026-09-02",
      deliveredOn: null,
      id: "30000000-0000-4000-8000-000000000001",
      internalDurationMinutes: null,
      internalPlannedAtUtc: null,
      resolutionNote: null,
      resolutionStatus: "planned",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/customers/${customerId}/contracts`) {
        return jsonResponse({ contracts: [contract] });
      }
      if (url.includes(`/${customerId}/contracts/${contractId}/month-plans/`)) {
        return jsonResponse({ monthPlan: { visits: [firstVisit] } });
      }
      if (url === `/api/customers/${otherCustomerId}/contracts`) {
        return jsonResponse({ contracts: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const onContractSaved = vi.fn();
    const onVisitsSaved = vi.fn();
    const user = userEvent.setup();
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <CustomerWorkspace
        customer={customer}
        live
        onContractSaved={onContractSaved}
        onVisitsSaved={onVisitsSaved}
      />,
    );

    await screen.findByDisplayValue("2026-09-02");
    await user.click(
      screen.getByRole("button", { name: "Sözleşmeyi düzenle" }),
    );
    fireEvent.input(screen.getByLabelText("Başlangıç"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.input(screen.getByLabelText("Bitiş"), {
      target: { value: "2026-01-01" },
    });
    await user.click(
      screen.getByRole("button", { name: "Değişiklikleri kaydet" }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <CustomerWorkspace
        customer={otherCustomer}
        live
        onContractSaved={onContractSaved}
        onVisitsSaved={onVisitsSaved}
      />,
    );

    expect(
      await screen.findByText("Önce sözleşmeyi kaydedin."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sözleşmeyi kaydet" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Başlangıç")).not.toHaveValue("2026-12-31");
    expect(screen.getByLabelText("Bitiş")).not.toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Aylık ücret")).toHaveValue("50000");
    expect(
      screen.getByRole("spinbutton", { name: /Ödeme günü/u }),
    ).toHaveValue(5);

    fireEvent.input(screen.getByLabelText("Başlangıç"), {
      target: { value: "2027-01-15" },
    });
    expect(screen.getByLabelText("Bitiş")).toHaveValue("2028-01-14");
  });

  it("edits an existing contract and reads native date values from FormData", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/contracts")) {
        return jsonResponse({ contracts: [contract] });
      }
      if (method === "GET" && url.includes("/month-plans/")) {
        return jsonResponse({ monthPlan: { visits: [] } });
      }
      if (method === "PATCH" && url.endsWith(`/${contractId}`)) {
        const body = JSON.parse(String(init?.body));
        requests.push({ body, method, url });
        return jsonResponse({ contract: { ...contract, ...body } });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWorkspace(fetchMock);

    await user.click(
      await screen.findByRole("button", { name: "Sözleşmeyi düzenle" }),
    );
    const startsOn = screen.getByLabelText("Başlangıç") as HTMLInputElement;
    const endsOn = screen.getByLabelText("Bitiş") as HTMLInputElement;

    // This mirrors browser automation that changes the native control without
    // giving React state a chance to re-render before submit.
    setNativeInputValue(startsOn, "2026-03-01");
    setNativeInputValue(endsOn, "2026-11-30");
    await user.click(
      screen.getByRole("button", { name: "Değişiklikleri kaydet" }),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      body: expect.objectContaining({
        endsOn: "2026-11-30",
        startsOn: "2026-03-01",
      }),
      method: "PATCH",
      url: `/api/customers/${customerId}/contracts/${contractId}`,
    });
    expect(
      await screen.findByRole("button", { name: "Sözleşmeyi düzenle" }),
    ).toBeInTheDocument();
  });

  it("submits a native visit date even when component state has not observed it", async () => {
    const putBodies: unknown[] = [];
    const putUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/contracts")) {
        return jsonResponse({ contracts: [contract] });
      }
      if (method === "GET" && url.includes("/month-plans/")) {
        return jsonResponse({ monthPlan: { visits: [] } });
      }
      if (method === "PUT" && url.includes("/month-plans/")) {
        const body = JSON.parse(String(init?.body));
        putBodies.push(body);
        putUrls.push(url);
        return jsonResponse({
          monthPlan: {
            visits: [
              {
                committedOn: body.visits[0].committedOn,
                deliveredOn: null,
                id: "30000000-0000-4000-8000-000000000001",
                internalDurationMinutes: null,
                internalPlannedAtUtc: null,
                resolutionNote: null,
                resolutionStatus: "planned",
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWorkspace(fetchMock);

    await user.click(
      await screen.findByRole("button", { name: "+ Ziyaret satırı" }),
    );
    const planMonth = screen.getByLabelText("Plan ayı") as HTMLInputElement;
    const visitDate = screen.getByLabelText("Ziyaret günü") as HTMLInputElement;
    setNativeInputValue(planMonth, "2026-10");
    setNativeInputValue(visitDate, "2026-10-02");
    await user.click(
      screen.getByRole("button", { name: "Aylık planı kaydet" }),
    );

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putUrls[0]?.endsWith("/month-plans/2026-10")).toBe(true);
    expect(putBodies[0]).toEqual({
      visits: [
        {
          committedOn: "2026-10-02",
          internalDurationMinutes: null,
          internalStartTime: null,
        },
      ],
    });
  });
});
