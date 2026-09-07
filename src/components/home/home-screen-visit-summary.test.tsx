import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/home/customer-workspace", () => ({
  CustomerWorkspace: ({
    customer,
    onVisitsSaved,
  }: {
    customer: { name: string };
    onVisitsSaved: (visits: readonly never[]) => void;
  }) => (
    <section aria-label={`${customer.name} test çalışma alanı`}>
      <button type="button" onClick={() => onVisitsSaved([])}>
        Test ziyaretini kaydet
      </button>
    </section>
  ),
}));

import { HomeScreen } from "@/components/home/home-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function istanbulToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const customerId = "10000000-0000-4000-8000-000000000001";
const baseCustomer = {
  contactNote: null,
  displayName: "Zevahir Home",
  email: null,
  id: customerId,
  overview: { nextVisitOn: null },
  phone: null,
  projects: [],
  shortCode: "ZEVAHIR",
  status: "active" as const,
};
const capabilities = {
  canLifecycleContracts: false,
  canLifecycleCustomers: false,
  canOpenCustomerDetails: true,
  canReadAudit: false,
  canReadBilling: false,
  canReadProjects: false,
  canReadReceivables: false,
  canReadVisits: true,
  canWriteCustomers: false,
} as const;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeScreen authoritative visit summary refresh", () => {
  it("keeps the newest response and exposes a retry when refresh fails", async () => {
    const olderRefresh = deferred<Response>();
    const newerRefresh = deferred<Response>();
    let customerRequestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url !== "/api/customers") {
        throw new Error(`Unexpected request: ${url}`);
      }
      customerRequestCount += 1;
      if (customerRequestCount === 1) {
        return jsonResponse({ customers: [baseCustomer] });
      }
      if (customerRequestCount === 2) return olderRefresh.promise;
      if (customerRequestCount === 3) return newerRefresh.promise;
      if (customerRequestCount === 4) return jsonResponse({}, 503);
      return jsonResponse({
        customers: [
          { ...baseCustomer, overview: { nextVisitOn: istanbulToday() } },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HomeScreen capabilities={capabilities} live />);

    const summary = await screen.findByRole("region", { name: "Müşteri özeti" });
    expect(
      within(summary).getByText("Bugün ziyaretli aktif müşteri").parentElement,
    ).toHaveTextContent("00");
    await user.click(screen.getByRole("button", { name: /Zevahir Home/u }));
    const mutationButton = screen.getByRole("button", {
      name: "Test ziyaretini kaydet",
    });
    await user.click(mutationButton);
    await user.click(mutationButton);
    await waitFor(() => expect(customerRequestCount).toBe(3));

    await act(async () => {
      newerRefresh.resolve(
        jsonResponse({
          customers: [
            { ...baseCustomer, overview: { nextVisitOn: istanbulToday() } },
          ],
        }),
      );
      await newerRefresh.promise;
    });
    await waitFor(() =>
      expect(
        within(summary).getByText("Bugün ziyaretli aktif müşteri").parentElement,
      ).toHaveTextContent("01"),
    );

    await act(async () => {
      olderRefresh.resolve(jsonResponse({ customers: [baseCustomer] }));
      await olderRefresh.promise;
    });
    expect(
      within(summary).getByText("Bugün ziyaretli aktif müşteri").parentElement,
    ).toHaveTextContent("01");

    await user.click(mutationButton);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Görünen sonraki ziyaret bilgisi eski olabilir");
    await user.click(
      within(alert).getByRole("button", { name: "Özeti yeniden dene" }),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(customerRequestCount).toBe(5);
  });

  it("applies the newest authoritative response to every customer after rapid saves", async () => {
    const secondCustomer = {
      ...baseCustomer,
      displayName: "İkinci Firma",
      id: "10000000-0000-4000-8000-000000000002",
      shortCode: "IKINCI",
    };
    const olderRefresh = deferred<Response>();
    const newerRefresh = deferred<Response>();
    let customerRequestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/finance/receivables") {
        return jsonResponse({
          receivables: [{ customerId, status: "overdue" }],
          summary: { outstanding: "100.0000", overdue: "100.0000" },
        });
      }
      if (url !== "/api/customers") {
        throw new Error(`Unexpected request: ${url}`);
      }
      customerRequestCount += 1;
      if (customerRequestCount === 1) {
        return jsonResponse({ customers: [baseCustomer, secondCustomer] });
      }
      if (customerRequestCount === 2) return olderRefresh.promise;
      if (customerRequestCount === 3) return newerRefresh.promise;
      throw new Error("Unexpected customer refresh.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <HomeScreen
        capabilities={{ ...capabilities, canReadReceivables: true }}
        live
      />,
    );

    const summary = await screen.findByRole("region", { name: "Müşteri özeti" });
    expect(screen.getByText("Gecikmiş ödeme")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Zevahir Home/u }));
    await user.click(
      screen.getByRole("button", { name: "Test ziyaretini kaydet" }),
    );
    await user.click(screen.getByRole("button", { name: /İkinci Firma/u }));
    await user.click(
      screen.getByRole("button", { name: "Test ziyaretini kaydet" }),
    );
    await waitFor(() => expect(customerRequestCount).toBe(3));

    const bothUpdated = [baseCustomer, secondCustomer].map((customer) => ({
      ...customer,
      overview: { nextVisitOn: istanbulToday() },
    }));
    await act(async () => {
      newerRefresh.resolve(jsonResponse({ customers: bothUpdated }));
      await newerRefresh.promise;
    });
    await waitFor(() =>
      expect(
        within(summary).getByText("Bugün ziyaretli aktif müşteri").parentElement,
      ).toHaveTextContent("02"),
    );

    await act(async () => {
      olderRefresh.resolve(
        jsonResponse({ customers: [baseCustomer, secondCustomer] }),
      );
      await olderRefresh.promise;
    });
    expect(
      within(summary).getByText("Bugün ziyaretli aktif müşteri").parentElement,
    ).toHaveTextContent("02");
    expect(screen.getByText("Gecikmiş ödeme")).toBeInTheDocument();
  });
});
