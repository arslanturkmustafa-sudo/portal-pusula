"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

import styles from "./task-report-workspace.module.css";

type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "normal" | "high" | "urgent";
type TaskReport = Readonly<{
  customer: Readonly<{
    displayName: string;
    id: string;
    shortCode: string;
    status: "active" | "inactive";
  }>;
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

export function TaskReportWorkspace() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const customerId = searchParams.get("customerId");
  const [request, setRequest] = useState<{
    query: string;
    report: TaskReport | null;
    state: "error" | "forbidden" | "ready" | "too-large";
  } | null>(null);
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

  const rangeLabel = useMemo(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to ? `${dateLabel(from)} – ${dateLabel(to)}` : "Tüm vade tarihleri";
  }, [searchParams]);

  if (!customerId) {
    return (
      <section className={styles.message}>
        <p className="eyebrow">FİRMA RAPORU</p>
        <h1>Önce bir firma seçin</h1>
        <p>Görevler sayfasındaki müşteri filtresinden firmayı seçip raporu açın.</p>
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
        <input name="customerId" type="hidden" value={report.customer.id} />
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
