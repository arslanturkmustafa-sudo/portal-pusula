"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

import styles from "./task-report-workspace.module.css";

type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "normal" | "high" | "urgent";
type ReportCustomer = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: "active" | "inactive";
}>;
type TaskReport = Readonly<{
  customer: ReportCustomer;
  filter: Readonly<{
    customerId: string;
    from?: string;
    status: "all" | "open" | TaskStatus;
    to?: string;
  }>;
  generatedAtUtc: string;
  generatedOn: string;
  summary: Readonly<{ completed: number; open: number; overdue: number; total: number }>;
  tasks: readonly Readonly<{
    assigneeDisplayName: string | null;
    completedAtUtc: string | null;
    description: string | null;
    dueOn: string | null;
    id: string;
    priority: TaskPriority;
    projectCode: string | null;
    projectName: string | null;
    status: TaskStatus;
    title: string;
  }>[];
}>;

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Havuz",
  blocked: "Beklemede",
  done: "Tamamlandı",
  cancelled: "İptal",
  in_progress: "Devam ediyor",
  todo: "Yapılacak",
};

const priorityLabels: Record<TaskPriority, string> = {
  high: "Yüksek",
  low: "Düşük",
  normal: "Normal",
  urgent: "Acil",
};

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Belirtilmedi";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function generatedLabel(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

function isReportCustomer(value: unknown): value is ReportCustomer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReportCustomer>;
  return (
    typeof candidate.displayName === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.shortCode === "string" &&
    (candidate.status === "active" || candidate.status === "inactive")
  );
}

export function TaskReportWorkspace() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const customerId = searchParams.get("customerId");
  const [request, setRequest] = useState<{
    query: string;
    report: TaskReport | null;
    state: "error" | "forbidden" | "ready" | "too-large";
  } | null>(null);
  const [customerRequest, setCustomerRequest] = useState<{
    customers: readonly ReportCustomer[];
    state: "error" | "loading" | "ready";
  }>({ customers: [], state: "loading" });
  const isCurrentRequest = request?.query === query;
  const report = isCurrentRequest ? request.report : null;
  const state = !customerId
    ? "idle"
    : isCurrentRequest
      ? request.state
      : "loading";

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    void fetch(`/api/reports/tasks?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToPortalLogin();
          return null;
        }
        if (response.status === 403) {
          setRequest({ query, report: null, state: "forbidden" });
          return null;
        }
        if (response.status === 422) {
          setRequest({ query, report: null, state: "too-large" });
          return null;
        }
        if (!response.ok) throw new Error("Task report unavailable.");
        return (await response.json()) as { report: TaskReport };
      })
      .then((payload) => {
        if (!payload) return;
        setRequest({ query, report: payload.report, state: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRequest({ query, report: null, state: "error" });
      });
    return () => controller.abort();
  }, [customerId, query]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/customers", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToPortalLogin();
          return null;
        }
        if (!response.ok) throw new Error("Report customers unavailable.");
        const payload = (await response.json()) as { customers?: unknown };
        if (!Array.isArray(payload.customers)) {
          throw new Error("Report customer response is invalid.");
        }
        const customers = payload.customers.filter(isReportCustomer);
        if (customers.length !== payload.customers.length) {
          throw new Error("Report customer response is invalid.");
        }
        return customers;
      })
      .then((customers) => {
        if (customers === null) return;
        setCustomerRequest({ customers, state: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCustomerRequest({ customers: [], state: "error" });
      });
    return () => controller.abort();
  }, []);

  const customerOptions = useMemo(() => {
    const options = new Map<string, ReportCustomer>();
    for (const customer of customerRequest.customers) {
      options.set(customer.id, customer);
    }
    if (report) options.set(report.customer.id, report.customer);
    return [...options.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "tr-TR"),
    );
  }, [customerRequest.customers, report]);

  const rangeLabel = useMemo(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to ? `${dateLabel(from)} – ${dateLabel(to)}` : "Tüm vade tarihleri";
  }, [searchParams]);

  if (!customerId) {
    return (
      <section className={`${styles.message} ${styles.customerPicker}`}>
        <p className="eyebrow">FİRMA RAPORU</p>
        <h1>Firma görev raporu</h1>
        <p>Raporlamak istediğiniz firmayı seçin; tarih ve durum aralığını sonraki ekranda daraltabilirsiniz.</p>
        {customerRequest.state === "loading" ? (
          <p role="status">Firma listesi hazırlanıyor…</p>
        ) : null}
        {customerRequest.state === "ready" && customerOptions.length > 0 ? (
          <form action="/gorevler/rapor" method="get">
            <label>
              <span>Firma</span>
              <select defaultValue="" name="customerId" required>
                <option disabled value="">Firma seçin</option>
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName} · {customer.shortCode}
                    {customer.status === "inactive" ? " (pasif)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-action" type="submit">Raporu aç</button>
          </form>
        ) : null}
        {customerRequest.state === "ready" && customerOptions.length === 0 ? (
          <p role="status">Raporlanabilecek firma bulunmuyor.</p>
        ) : null}
        {customerRequest.state === "error" ? (
          <p role="alert">Firma listesine ulaşılamadı. Görev panosundan bir firma seçerek yeniden deneyin.</p>
        ) : null}
        <Link className="text-action" href="/gorevler">Görevlere dön</Link>
      </section>
    );
  }

  if (state !== "ready" || !report) {
    const copy =
      state === "loading"
        ? "Firma görev raporu hazırlanıyor…"
        : state === "forbidden"
          ? "Bu raporu dışa aktarma yetkiniz yok."
          : state === "too-large"
            ? "Rapor 1.000 kaydı aşıyor. Tarih veya durum filtresini daraltın."
            : "Rapor şu anda hazırlanamadı. Filtreleri kontrol edip yeniden deneyin.";
    return <p className={styles.message} role={state === "loading" ? "status" : "alert"}>{copy}</p>;
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.actions}>
        <Link className="text-action" href="/gorevler">Görev panosuna dön</Link>
        <button className="primary-action" type="button" onClick={() => window.print()}>
          PDF olarak kaydet / Yazdır
        </button>
      </div>

      <form className={styles.controls} action="/gorevler/rapor" method="get">
        <label>
          <span>Firma</span>
          <select defaultValue={report.customer.id} name="customerId" required>
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName} · {customer.shortCode}
                {customer.status === "inactive" ? " (pasif)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label><span>Vade başlangıcı</span><input defaultValue={report.filter.from ?? ""} name="from" type="date" /></label>
        <label><span>Vade bitişi</span><input defaultValue={report.filter.to ?? ""} name="to" type="date" /></label>
        <label>
          <span>Durum</span>
          <select defaultValue={report.filter.status} name="status">
            <option value="all">Tüm durumlar</option>
            <option value="open">Açık görevler</option>
            <option value="backlog">Havuz</option>
            <option value="todo">Yapılacak</option>
            <option value="in_progress">Devam ediyor</option>
            <option value="blocked">Beklemede</option>
            <option value="done">Tamamlandı</option>
            <option value="cancelled">İptal</option>
          </select>
        </label>
        <button className="text-action" type="submit">Raporu yenile</button>
      </form>

      <article className={styles.report} aria-labelledby="task-report-title">
        <header className={styles.reportHeader}>
          <Image
            alt="Mühendis Kafası Eğitim Danışmanlık"
            height={100}
            priority
            src="/brand/muhendis-kafasi-logo.png"
            unoptimized
            width={191}
          />
          <div>
            <p>PORTAL PUSULA / OPERASYON RAPORU</p>
            <h1 id="task-report-title">Firma görev raporu</h1>
          </div>
        </header>

        <section className={styles.customerBand}>
          <div><span>Firma</span><strong>{report.customer.displayName}</strong></div>
          <div><span>Firma kodu</span><strong>{report.customer.shortCode}</strong></div>
          <div><span>Vade aralığı</span><strong>{rangeLabel}</strong></div>
          <div><span>Oluşturma</span><strong>{generatedLabel(report.generatedAtUtc)}</strong></div>
        </section>

        <section className={styles.metrics} aria-label="Rapor özeti">
          <div><span>Toplam</span><strong>{report.summary.total}</strong></div>
          <div><span>Açık</span><strong>{report.summary.open}</strong></div>
          <div><span>Geciken</span><strong>{report.summary.overdue}</strong></div>
          <div><span>Tamamlanan</span><strong>{report.summary.completed}</strong></div>
        </section>

        <section className={styles.taskList}>
          <div className={styles.listHeading}>
            <h2>Görev dökümü</h2>
            <span>{report.tasks.length} kayıt</span>
          </div>
          {report.tasks.length === 0 ? (
            <p className={styles.empty}>Seçilen filtrelerde görev bulunmuyor.</p>
          ) : (
            report.tasks.map((task, index) => (
              <article className={styles.task} key={task.id}>
                <span className={styles.taskIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className={styles.taskTitle}>
                    <h3>{task.title}</h3>
                    <span>{statusLabels[task.status]}</span>
                  </div>
                  {task.description ? <p>{task.description}</p> : null}
                  <dl>
                    <div><dt>Proje</dt><dd>{task.projectName ?? "Bağlantı yok"}{task.projectCode ? ` · ${task.projectCode}` : ""}</dd></div>
                    <div><dt>Sorumlu</dt><dd>{task.assigneeDisplayName ?? "Atanmadı"}</dd></div>
                    <div><dt>Vade</dt><dd>{dateLabel(task.dueOn)}</dd></div>
                    <div><dt>Öncelik</dt><dd>{priorityLabels[task.priority]}</dd></div>
                  </dl>
                </div>
              </article>
            ))
          )}
        </section>

        <footer className={styles.reportFooter}>
          <span>Mühendis Kafası Eğitim Danışmanlık</span>
          <span>Portal Pusula tarafından oluşturuldu</span>
        </footer>
      </article>
    </div>
  );
}
