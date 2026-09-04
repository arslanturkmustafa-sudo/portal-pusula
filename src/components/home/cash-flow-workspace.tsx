"use client";

import Decimal from "decimal.js";
import { useEffect, useState } from "react";

import styles from "@/components/home/cash-flow-workspace.module.css";
import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";

type Direction = "inflow" | "outflow";
type ActualKind =
  | "card_installment"
  | "commission_payment"
  | "customer_collection"
  | "direct_expense"
  | "partner_contribution";
type ForecastKind =
  | "card_installment"
  | "commission_receivable"
  | "customer_receivable"
  | "direct_expense"
  | "partner_contribution";

type ActualLine = Readonly<{
  amount: string;
  direction: Direction;
  entryCount: number;
  kind: ActualKind;
}>;

type ForecastLine = Readonly<{
  amount: string;
  bucket: "overdue" | "scheduled" | "undated";
  direction: Direction;
  entryCount: number;
  kind: ForecastKind;
}>;

type CashFlowPayload = Readonly<{
  actual: Readonly<{
    inflowAmount: string;
    lines: readonly ActualLine[];
    netAmount: string;
    outflowAmount: string;
  }>;
  assumptions: readonly string[];
  balanceStatus: "not_configured";
  forecast: Readonly<{
    lines: readonly ForecastLine[];
    overdue: Readonly<{ inflowAmount: string; netAmount: string; outflowAmount: string }>;
    scheduled: Readonly<{ inflowAmount: string; netAmount: string; outflowAmount: string }>;
    undatedInflowAmount: string;
  }>;
  generatedOn: string;
  month: string;
  unclassifiedExpenses: Readonly<{ amount: string; entryCount: number }>;
}>;

const reportRows = [
  {
    actualKind: "customer_collection" as const,
    forecastKind: "customer_receivable" as const,
    label: "Müşteri tahsilatları",
  },
  {
    actualKind: "partner_contribution" as const,
    forecastKind: "partner_contribution" as const,
    label: "Ortak katkıları",
  },
  {
    actualKind: "commission_payment" as const,
    forecastKind: "commission_receivable" as const,
    label: "Ortaklık komisyonları",
  },
  {
    actualKind: "direct_expense" as const,
    forecastKind: "direct_expense" as const,
    label: "Nakit / havale giderleri",
  },
  {
    actualKind: "card_installment" as const,
    forecastKind: "card_installment" as const,
    label: "Kredi kartı taksitleri",
  },
] as const;

function istanbulMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function formatMoney(value: string): string {
  try {
    const [integer, fraction] = new Decimal(value).toFixed(2).split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
    return fraction === "00" ? `₺${grouped}` : `₺${grouped},${fraction}`;
  } catch {
    return "—";
  }
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function actualAmount(
  payload: CashFlowPayload,
  kind: ActualKind,
  direction: Direction,
): string | null {
  return payload.actual.lines.find(
    (line) => line.kind === kind && line.direction === direction,
  )?.amount ?? null;
}

function forecastAmount(
  payload: CashFlowPayload,
  kind: ForecastKind,
  direction: Direction,
  bucket: ForecastLine["bucket"],
): string | null {
  return payload.forecast.lines.find(
    (line) =>
      line.kind === kind && line.direction === direction && line.bucket === bucket,
  )?.amount ?? null;
}

function amountCell(value: string | null): string {
  return value === null || new Decimal(value).isZero() ? "—" : formatMoney(value);
}

export function CashFlowWorkspace() {
  const [month, setMonth] = useState(istanbulMonth);
  const [payload, setPayload] = useState<CashFlowPayload | null>(null);
  const [state, setState] = useState<"error" | "forbidden" | "loading" | "ready">(
    "loading",
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/finance/cash-flow?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return null;
        }
        if (response.status === 403) {
          setState("forbidden");
          return null;
        }
        if (!response.ok) throw new Error("Cash flow report is unavailable.");
        return (await response.json()) as CashFlowPayload;
      })
      .then((nextPayload) => {
        if (!nextPayload) return;
        setPayload(nextPayload);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [month, revision]);

  return (
    <section className={styles.workspace} aria-labelledby="cash-flow-title">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Aylık hareket raporu</p>
          <h2 id="cash-flow-title">Nakit akışı</h2>
          <p>
            Gerçekleşen para hareketleri ile planlanan ve gecikmiş kalemler ayrı
            kolonlarda; kart gideri ve taksiti iki kez sayılmaz.
          </p>
        </div>
        <label>
          <span>Rapor dönemi</span>
          <input
            aria-label="Nakit akışı dönemi"
            max="9999-12"
            min="1000-01"
            type="month"
            value={month}
            onChange={(event) => {
              setState("loading");
              setMonth(event.target.value);
            }}
          />
        </label>
      </header>

      {state === "forbidden" ? (
        <p className={styles.message} role="alert">
          Bu rapor finans raporu izni olan hesaplara açıktır.
        </p>
      ) : null}
      {state === "error" ? (
        <div className={styles.message} role="alert">
          <span>Nakit akışı hazırlanamadı.</span>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              setRevision((value) => value + 1);
            }}
          >
            Yeniden dene
          </button>
        </div>
      ) : null}
      {state === "loading" && !payload ? (
        <p className={styles.loading} role="status">Nakit hareketleri uzlaştırılıyor…</p>
      ) : null}

      {payload ? (
        <>
          <div className={styles.period} aria-live="polite">
            <strong>{formatMonth(payload.month)}</strong>
            <span>{payload.generatedOn} itibarıyla</span>
          </div>

          <dl className={styles.summary}>
            <div>
              <dt>Gerçekleşen giriş</dt>
              <dd>{formatMoney(payload.actual.inflowAmount)}</dd>
            </div>
            <div>
              <dt>Gerçekleşen çıkış</dt>
              <dd>{formatMoney(payload.actual.outflowAmount)}</dd>
            </div>
            <div className={new Decimal(payload.actual.netAmount).isNegative() ? styles.negative : styles.positive}>
              <dt>Gerçekleşen net</dt>
              <dd>{formatMoney(payload.actual.netAmount)}</dd>
            </div>
            <div>
              <dt>Planlanan net</dt>
              <dd>{formatMoney(payload.forecast.scheduled.netAmount)}</dd>
            </div>
          </dl>

          <div className={styles.balanceNotice}>
            <strong>Bakiye çıpası henüz tanımlı değil.</strong>
            <span>
              Bu nedenle sıfırdan açılış/kapanış bakiyesi uydurulmuyor; rapor
              yalnız kayıtlı hareketlerin netini gösteriyor.
            </span>
          </div>

          <div className={styles.tableFrame}>
            <table>
              <caption>Gerçekleşen, planlanan ve gecikmiş nakit hareketleri</caption>
              <thead>
                <tr>
                  <th scope="col">Hareket</th>
                  <th scope="col">Gerçek giriş</th>
                  <th scope="col">Gerçek çıkış</th>
                  <th scope="col">Planlanan giriş</th>
                  <th scope="col">Planlanan çıkış</th>
                  <th scope="col">Gecikmiş</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row) => {
                  const overdueIn = forecastAmount(payload, row.forecastKind, "inflow", "overdue");
                  const overdueOut = forecastAmount(payload, row.forecastKind, "outflow", "overdue");
                  const overdue = overdueIn ?? overdueOut;
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td data-label="Gerçek giriş">{amountCell(actualAmount(payload, row.actualKind, "inflow"))}</td>
                      <td data-label="Gerçek çıkış">{amountCell(actualAmount(payload, row.actualKind, "outflow"))}</td>
                      <td data-label="Planlanan giriş">{amountCell(forecastAmount(payload, row.forecastKind, "inflow", "scheduled"))}</td>
                      <td data-label="Planlanan çıkış">{amountCell(forecastAmount(payload, row.forecastKind, "outflow", "scheduled"))}</td>
                      <td data-label="Gecikmiş" className={overdue ? styles.overdue : undefined}>{amountCell(overdue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.watchlist}>
            <article>
              <span>Gecikmiş net hareket</span>
              <strong>{formatMoney(payload.forecast.overdue.netAmount)}</strong>
              <small>Bugün itibarıyla açık kalan vadeli kalemler</small>
            </article>
            <article>
              <span>Tarihi belirsiz komisyon</span>
              <strong>{formatMoney(payload.forecast.undatedInflowAmount)}</strong>
              <small>Ajansın tahsil ettiği, ödeme günü girilmemiş pay</small>
            </article>
            <article>
              <span>Sınıflandırılmamış gider</span>
              <strong>{formatMoney(payload.unclassifiedExpenses.amount)}</strong>
              <small>{payload.unclassifiedExpenses.entryCount} “diğer” ödeme kaydı</small>
            </article>
          </div>

          <details className={styles.assumptions}>
            <summary>Hesaplama notları</summary>
            <ul>
              {payload.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
