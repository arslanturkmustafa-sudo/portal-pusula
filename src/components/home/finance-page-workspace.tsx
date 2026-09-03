"use client";

import { useEffect, useState } from "react";

import { FinanceWorkspace } from "@/components/home/finance-workspace";

type StoredCustomer = Readonly<{
  displayName: string;
  id: string;
  projects?: readonly Readonly<{
    displayName: string;
    id: string;
    shortCode: string;
    status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
  }>[];
}>;

type FinanceCustomer = Readonly<{
  id: string;
  name: string;
  projects: readonly Readonly<{
    displayName: string;
    id: string;
    shortCode: string;
    status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
  }>[];
}>;

type FinanceProject = NonNullable<FinanceCustomer["projects"]>[number];

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

export function FinancePageWorkspace() {
  const [customers, setCustomers] = useState<readonly FinanceCustomer[]>([]);
  const [projects, setProjects] = useState<readonly FinanceProject[]>([]);
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
            projects: customer.projects ?? [],
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

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/projects", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!response.ok) throw new Error("Project list is unavailable.");
        return (await response.json()) as { projects?: FinanceProject[] };
      })
      .then((payload) => {
        if (!payload) return;
        setProjects(payload.projects ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProjects([]);
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
      <FinanceWorkspace customers={customers} live projects={projects} />
    </>
  );
}
