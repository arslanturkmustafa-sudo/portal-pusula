"use client";

import { useEffect, useState } from "react";

import { FinanceWorkspace } from "@/components/home/finance-workspace";

type StoredCustomer = Readonly<{
  displayName: string;
  id: string;
}>;

type FinanceCustomer = Readonly<{
  id: string;
  name: string;
}>;

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

export function FinancePageWorkspace() {
  const [customers, setCustomers] = useState<readonly FinanceCustomer[]>([]);
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/customers", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!response.ok) throw new Error("Customer list is unavailable.");
        return (await response.json()) as { customers?: StoredCustomer[] };
      })
      .then((payload) => {
        if (!payload) return;
        setCustomers(
          (payload.customers ?? []).map((customer) => ({
            id: customer.id,
            name: customer.displayName,
          })),
        );
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });

    return () => controller.abort();
  }, []);

  return (
    <>
      {loadState === "error" ? (
        <p className="entry-error finance-feedback" role="alert">
          Müşteri listesine ulaşılamadı. Finans kayıtları görüntülenebilir ancak
          müşteri seçilerek işlem yapılamayabilir.
        </p>
      ) : null}
      <FinanceWorkspace customers={customers} live />
    </>
  );
}
