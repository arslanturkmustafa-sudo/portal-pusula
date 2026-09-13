import Link from "next/link";

import type { TodayOverview } from "@/features/today";

import styles from "./my-day-workspace.module.css";

export type MyDayCapabilities = Readonly<{
  canCreateExpenses: boolean;
  canCreateTasks: boolean;
  canReadFinance: boolean;
  canReadPlanning: boolean;
  canReadTasks: boolean;
  canReadVisits: boolean;
}>;

type MyDayWorkspaceProps = Readonly<{
  capabilities: MyDayCapabilities;
  overview: TodayOverview | null;
}>;

const taskStatusLabels = {
  backlog: "Beklemede",
  blocked: "Engelli",
  done: "Tamamlandı",
  in_progress: "Devam ediyor",
  todo: "Yapılacak",
} as const;

function dateAtNoonUtc(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul",
  }).format(dateAtNoonUtc(value));
}

function databaseUtcDate(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/u.exec(
      value,
    );
  if (match === null) return null;
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      milliseconds,
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeLabel(value: string | null): string {
  if (value === null) return "Saat belirtilmedi";
  const instant = databaseUtcDate(value);
  if (instant === null) return "Saat belirtilmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(instant);
}

function moneyLabel(value: string): string {
  return new Intl.NumberFormat("tr-TR", {
    currency: "TRY",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}

function EmptySection({ children }: Readonly<{ children: React.ReactNode }>) {
  return <p className={styles.empty}>{children}</p>;
}

export function MyDayWorkspace({
  capabilities,
  overview,
}: MyDayWorkspaceProps) {
  if (overview === null) {
    return (
      <section className={styles.unavailable} role="alert">
        <strong>Günün özeti şu anda alınamadı.</strong>
        <p>Bağlantıyı kontrol edip sayfayı yeniden deneyin.</p>
        <Link href="/gunum">Yeniden dene</Link>
      </section>
    );
  }

  const receivables = (overview.financeItems ?? []).filter(
    (item) => item.direction === "inflow",
  );
  const payments = (overview.financeItems ?? []).filter(
    (item) => item.direction === "outflow",
  );
  const quickActions = [
    ...(capabilities.canReadPlanning
      ? [{ href: "/gunluk-plan", label: "Planlamayı aç", tone: "primary" }]
      : []),
    ...(capabilities.canCreateTasks
      ? [{ href: "/gorevler?action=create", label: "Görev oluştur", tone: "plain" }]
      : capabilities.canReadTasks
        ? [{ href: "/gorevler", label: "Görevleri aç", tone: "plain" }]
        : []),
    ...(capabilities.canCreateExpenses
      ? [{ href: "/finans/giderler?action=create", label: "Gider ekle", tone: "plain" }]
      : []),
    ...(capabilities.canReadFinance
      ? [{ href: "/finans/nakit-akisi", label: "Nakit akışı", tone: "plain" }]
      : []),
  ] as const;

  return (
    <div className={styles.workspace}>
      {quickActions.length > 0 ? (
        <nav aria-label="Günüm hızlı işlemleri" className={styles.actions}>
          {quickActions.map((action) => (
            <Link
              className={
                action.tone === "primary"
                  ? styles.primaryAction
                  : styles.action
              }
              href={action.href}
              key={action.href}
            >
              {action.label}
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-label="Gün özeti" className={styles.summary}>
        {capabilities.canReadVisits ? (
          <article>
            <span>Planlı ziyaret</span>
            <strong>{overview.visits.length}</strong>
            <small>Bugünkü saha akışı</small>
          </article>
        ) : null}
        {capabilities.canReadTasks ? (
          <article>
            <span>Açık görev</span>
            <strong>{overview.tasks.length}</strong>
            <small>Bugün takvimde olan</small>
          </article>
        ) : null}
        {capabilities.canReadFinance ? (
          <>
            <article>
              <span>Vadesi gelen alacak</span>
              <strong>{receivables.length}</strong>
              <small>Tahsilat bekleyen</small>
            </article>
            <article>
              <span>Vadesi gelen ödeme</span>
              <strong>{payments.length}</strong>
              <small>Ödeme bekleyen</small>
            </article>
          </>
        ) : null}
      </section>

      <div className={styles.grid}>
        {capabilities.canReadVisits ? (
          <section aria-labelledby="my-day-visits" className={styles.panel}>
            <header className={styles.panelHeader}>
              <div>
                <p>Saha</p>
                <h2 id="my-day-visits">Ziyaretler</h2>
              </div>
              <Link href="/gunluk-plan">Planlamaya git</Link>
            </header>
            {overview.visits.length === 0 ? (
              <EmptySection>Bugün için açık ziyaret bulunmuyor.</EmptySection>
            ) : (
              <ol className={styles.list}>
                {overview.visits.map((visit) => (
                  <li className={styles.row} key={visit.visitId}>
                    <time>{timeLabel(visit.internalPlannedAtUtc)}</time>
                    <div>
                      <strong>{visit.customerName}</strong>
                      <span>
                        {visit.customerCode}
                        {visit.locationLabel ? ` · ${visit.locationLabel}` : ""}
                      </span>
                    </div>
                    <span className={styles.status}>
                      {visit.resolutionStatus === "makeup_pending"
                        ? "Telafi bekliyor"
                        : "Planlandı"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        {capabilities.canReadTasks ? (
          <section aria-labelledby="my-day-tasks" className={styles.panel}>
            <header className={styles.panelHeader}>
              <div>
                <p>İş akışı</p>
                <h2 id="my-day-tasks">Yapılacak görevler</h2>
              </div>
              <Link href="/gorevler">Görevlere git</Link>
            </header>
            {overview.tasks.length === 0 ? (
              <EmptySection>Bugün için açık görev bulunmuyor.</EmptySection>
            ) : (
              <ol className={styles.list}>
                {overview.tasks.map((task) => (
                  <li className={styles.row} key={task.id}>
                    <span className={styles.taskMarker} aria-hidden="true" />
                    <div>
                      <strong>{task.title}</strong>
                      <span>
                        {[task.customerName, task.projectName, task.locationLabel]
                          .filter(Boolean)
                          .join(" · ") || "Genel görev"}
                      </span>
                    </div>
                    <span className={styles.status}>
                      {taskStatusLabels[task.status]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        {capabilities.canReadFinance ? (
          <section
            aria-labelledby="my-day-finance"
            className={`${styles.panel} ${styles.financePanel}`}
          >
            <header className={styles.panelHeader}>
              <div>
                <p>Finans ajandası</p>
                <h2 id="my-day-finance">Bugün ve geciken vadeler</h2>
              </div>
              <Link href="/finans/nakit-akisi">Nakit akışına git</Link>
            </header>
            <div className={styles.financeGrid}>
              <div>
                <h3>Vadesi gelen alacaklar</h3>
                {receivables.length === 0 ? (
                  <EmptySection>Açık tahsilat bulunmuyor.</EmptySection>
                ) : (
                  <ol className={styles.financeList}>
                    {receivables.map((item, index) => (
                      <li key={`${item.dueOn}-${item.label}-${index}`}>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.sourceLabel ?? "Genel alacak"}</span>
                        </div>
                        <div className={styles.amount}>
                          <strong>{moneyLabel(item.remainingAmount)}</strong>
                          <span>
                            {item.dueOn < overview.businessDate
                              ? "Gecikmiş"
                              : "Bugün"}
                            {` · ${dateLabel(item.dueOn)}`}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <h3>Vadesi gelen ödemeler</h3>
                {payments.length === 0 ? (
                  <EmptySection>Açık ödeme bulunmuyor.</EmptySection>
                ) : (
                  <ol className={styles.financeList}>
                    {payments.map((item, index) => (
                      <li key={`${item.dueOn}-${item.label}-${index}`}>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.sourceLabel ?? "Genel ödeme"}</span>
                        </div>
                        <div className={styles.amount}>
                          <strong>{moneyLabel(item.remainingAmount)}</strong>
                          <span>
                            {item.dueOn < overview.businessDate
                              ? "Gecikmiş"
                              : "Bugün"}
                            {` · ${dateLabel(item.dueOn)}`}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
