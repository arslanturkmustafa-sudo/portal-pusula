"use client";

import Decimal from "decimal.js";
import { type CSSProperties, useEffect, useState } from "react";

import styles from "@/components/home/cash-flow-workspace.module.css";
import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";

type Granularity = "monthly" | "weekly";

type Totals = Readonly<{
  inflowAmount: string;
  netAmount: string;
  outflowAmount: string;
}>;

type CashFlowPeriod = Readonly<{
  accountOpeningAmount: string;
  actual: Totals & Readonly<{ entryCount: number }>;
  closingBalanceAmount: string;
  endOn: string;
  forecast: Readonly<{ overdue: Totals; scheduled: Totals }>;
  openingBalanceAmount: string;
  startOn: string;
}>;

type CashFlowPayload = Readonly<{
  actual: Totals & Readonly<{ entryCount: number }>;
  assumptions: readonly string[];
  balance: Readonly<{
    accountOpeningAmount: string;
    accountCount: number;
    asOfOn: string;
    closingBalanceAmount: string;
    openingBalanceAmount: string;
    status: "configured" | "not_configured";
  }>;
  forecast: Readonly<{
    overdue: Totals;
    overdueInRange: Totals;
    scheduled: Totals;
    undatedInflowAmount: string;
  }>;
  generatedOn: string;
  granularity: Granularity;
  periods: readonly CashFlowPeriod[];
  range: Readonly<{ from: string; to: string }>;
  unclassifiedExpenses: Readonly<{ amount: string; entryCount: number }>;
}>;

type ReportFilter = Readonly<{
  from: string;
  granularity: Granularity;
  to: string;
}>;

const DAY_IN_MILLISECONDS = 86_400_000;

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

function defaultFilter(): ReportFilter {
  const today = istanbulToday();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {
    from: `${today.slice(0, 7)}-01`,
    granularity: "weekly",
    to: monthEnd,
  };
}

function isoDayNumber(value: string): number {
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  ) / DAY_IN_MILLISECONDS;
}

function filterError(filter: ReportFilter): string | null {
  if (!filter.from || !filter.to) return "Başlangıç ve bitiş tarihlerini seçin.";
  const from = isoDayNumber(filter.from);
  const to = isoDayNumber(filter.to);
  if (to < from) return "Bitiş tarihi başlangıç tarihinden önce olamaz.";
  if (to - from > 365) return "Rapor aralığı en fazla 366 gün olabilir.";
  return null;
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

function formatDate(value: string, includeYear = true): string {
  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
      12,
    ),
  );
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Istanbul",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);
}

function formatPeriod(period: Pick<CashFlowPeriod, "endOn" | "startOn">): string {
  if (period.startOn === period.endOn) return formatDate(period.startOn);
  const sameYear = period.startOn.slice(0, 4) === period.endOn.slice(0, 4);
  return `${formatDate(period.startOn, !sameYear)} – ${formatDate(period.endOn)}`;
}

function tone(value: string): string {
  const amount = new Decimal(value);
  if (amount.isZero()) return styles.neutral;
  return amount.isNegative() ? styles.negative : styles.positive;
}

function barSize(value: string, maximum: Decimal): CSSProperties {
  if (maximum.isZero()) return { "--bar-size": "0%" } as CSSProperties;
  const percentage = Decimal.min(
    new Decimal(value).abs().dividedBy(maximum).times(100),
    100,
  ).toDecimalPlaces(2);
  return { "--bar-size": `${percentage.toString()}%` } as CSSProperties;
}

function reportUrl(filter: ReportFilter): string {
  const parameters = new URLSearchParams({
    from: filter.from,
    granularity: filter.granularity,
    to: filter.to,
  });
  return `/api/finance/cash-flow?${parameters.toString()}`;
}

export function CashFlowWorkspace() {
  const [filters, setFilters] = useState(() => {
    const initial = defaultFilter();
    return { applied: initial, draft: initial };
  });
  const [payload, setPayload] = useState<CashFlowPayload | null>(null);
  const [state, setState] = useState<"error" | "forbidden" | "loading" | "ready">(
    "loading",
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(reportUrl(filters.applied), {
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
          setPayload(null);
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
        setPayload(null);
        setState("error");
      });
    return () => controller.abort();
  }, [filters.applied, revision]);

  const chartMaximum = payload
    ? payload.periods.reduce(
        (maximum, period) =>
          Decimal.max(
            maximum,
            period.actual.inflowAmount,
            period.actual.outflowAmount,
          ),
        new Decimal(0),
      )
    : new Decimal(0);

  function updateDraft(next: Partial<ReportFilter>): void {
    setValidationMessage(null);
    setFilters((current) => ({
      ...current,
      draft: { ...current.draft, ...next },
    }));
  }

  return (
    <section
      className={styles.workspace}
      aria-busy={state === "loading"}
      aria-labelledby="cash-flow-title"
    >
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Likidite ve dönem raporu</p>
          <h2 id="cash-flow-title">Nakit akışı</h2>
          <p>
            Hesap defterindeki gerçekleşen hareketleri haftalık veya aylık
            dönemlerde izleyin; açık yükümlülükleri bakiyeden ayrı değerlendirin.
          </p>
        </div>
      </header>

      <aside className={styles.scopeNotice} aria-label="Nakit akışı rapor kapsamı">
        <strong>Gerçekleşen hareket kapsamı</strong>
        <p>
          Gerçekleşen gelir ve giderler yalnız Hesaplar bölümündeki hesap
          defterine kaydedilmiş hareketlerden oluşur. Giderler, tahsilatlar ve
          kart taksitleri kendi modüllerinden otomatik olarak bu toplama
          yansımaz; gerçekleştiğinde ilgili kasa veya banka hesabına ayrıca
          kaydedilmelidir.
        </p>
      </aside>

      <form
        className={styles.filters}
        aria-label="Nakit akışı rapor aralığı"
        onSubmit={(event) => {
          event.preventDefault();
          const message = filterError(filters.draft);
          setValidationMessage(message);
          if (message) return;
          setPayload(null);
          setState("loading");
          if (
            filters.applied.from === filters.draft.from &&
            filters.applied.to === filters.draft.to &&
            filters.applied.granularity === filters.draft.granularity
          ) {
            setRevision((value) => value + 1);
            return;
          }
          setFilters((current) => ({ ...current, applied: { ...current.draft } }));
        }}
      >
        <fieldset className={styles.granularity}>
          <legend>Tarih kırılımı</legend>
          <label>
            <input
              checked={filters.draft.granularity === "weekly"}
              name="cash-flow-granularity"
              onChange={() => updateDraft({ granularity: "weekly" })}
              type="radio"
              value="weekly"
            />
            <span>Haftalık</span>
          </label>
          <label>
            <input
              checked={filters.draft.granularity === "monthly"}
              name="cash-flow-granularity"
              onChange={() => updateDraft({ granularity: "monthly" })}
              type="radio"
              value="monthly"
            />
            <span>Aylık</span>
          </label>
        </fieldset>
        <label className={styles.dateField}>
          <span>Başlangıç</span>
          <input
            aria-describedby="cash-flow-range-note"
            max="9999-12-31"
            min="1000-01-01"
            onChange={(event) => updateDraft({ from: event.target.value })}
            required
            type="date"
            value={filters.draft.from}
          />
        </label>
        <label className={styles.dateField}>
          <span>Bitiş</span>
          <input
            aria-describedby="cash-flow-range-note"
            max="9999-12-31"
            min={filters.draft.from || "1000-01-01"}
            onChange={(event) => updateDraft({ to: event.target.value })}
            required
            type="date"
            value={filters.draft.to}
          />
        </label>
        <button className={styles.applyButton} type="submit">
          Raporu oluştur
        </button>
        <small id="cash-flow-range-note">En fazla 366 günlük aralık seçilebilir.</small>
      </form>

      {validationMessage ? (
        <p className={styles.validation} role="alert">
          {validationMessage}
        </p>
      ) : null}
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
      {state === "loading" ? (
        <p className={styles.loading} role="status">
          Nakit hareketleri uzlaştırılıyor…
        </p>
      ) : null}

      {payload ? (
        <div className={styles.report}>
          <div className={styles.period} aria-live="polite">
            <strong>
              {formatDate(payload.range.from)} – {formatDate(payload.range.to)}
            </strong>
            <span>
              {payload.generatedOn} itibarıyla · {payload.periods.length} {" "}
              {payload.granularity === "weekly" ? "haftalık" : "aylık"} dönem
            </span>
          </div>

          <dl className={styles.summary}>
            <div>
              <dt>Dönem açılışı</dt>
              <dd>{formatMoney(payload.balance.openingBalanceAmount)}</dd>
            </div>
            <div>
              <dt>Yeni hesap açılışı</dt>
              <dd>{formatMoney(payload.balance.accountOpeningAmount)}</dd>
            </div>
            <div className={styles.inflow}>
              <dt>Gerçekleşen gelir</dt>
              <dd>{formatMoney(payload.actual.inflowAmount)}</dd>
            </div>
            <div className={styles.outflow}>
              <dt>Gerçekleşen gider</dt>
              <dd>{formatMoney(payload.actual.outflowAmount)}</dd>
            </div>
            <div className={tone(payload.actual.netAmount)}>
              <dt>Net nakit akışı</dt>
              <dd>{formatMoney(payload.actual.netAmount)}</dd>
            </div>
            <div className={tone(payload.balance.closingBalanceAmount)}>
              <dt>Kapanış bakiyesi</dt>
              <dd>{formatMoney(payload.balance.closingBalanceAmount)}</dd>
              <small>{formatDate(payload.balance.asOfOn)} itibarıyla</small>
            </div>
          </dl>

          {payload.balance.status === "not_configured" ? (
            <div className={styles.balanceNotice} role="note">
              <strong>Hesap bakiyesi henüz tanımlı değil.</strong>
              <span>
                Kasa veya banka hesabı eklenene kadar açılış ve kapanış sıfır
                görünür; tahminler yine ayrı izlenir.
              </span>
            </div>
          ) : (
            <div className={styles.balanceNotice} role="note">
              <strong>{payload.balance.accountCount} hesap uzlaştırıldı.</strong>
              <span>
                Kapanış bakiyesi; dönem açılışı, dönem içinde açılan hesapların
                başlangıç bakiyesi ve gerçekleşen net akışla uzlaştırılır. İç
                transferler toplam likiditeyi değiştirmez.
              </span>
            </div>
          )}

          <section className={styles.trend} aria-labelledby="cash-flow-trend-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className="eyebrow">Gerçekleşen hareket</p>
                <h3 id="cash-flow-trend-title">Dönemsel giriş / çıkış</h3>
              </div>
              <span>{payload.actual.entryCount} hesap hareketi</span>
            </div>
            <ol>
              {payload.periods.map((period) => {
                const label = formatPeriod(period);
                return (
                  <li key={period.startOn}>
                    <div className={styles.trendLabel}>
                      <strong>{label}</strong>
                      <span className={tone(period.actual.netAmount)}>
                        {formatMoney(period.actual.netAmount)} net
                      </span>
                    </div>
                    <div className={styles.barGroup}>
                      <div
                        aria-label={`${label} gelir ${formatMoney(period.actual.inflowAmount)}`}
                        className={styles.barTrack}
                        role="img"
                      >
                        <span
                          className={styles.inflowBar}
                          style={barSize(period.actual.inflowAmount, chartMaximum)}
                        />
                      </div>
                      <div
                        aria-label={`${label} gider ${formatMoney(period.actual.outflowAmount)}`}
                        className={styles.barTrack}
                        role="img"
                      >
                        <span
                          className={styles.outflowBar}
                          style={barSize(period.actual.outflowAmount, chartMaximum)}
                        />
                      </div>
                    </div>
                    <div className={styles.trendAmounts}>
                      <span>Gelir {formatMoney(period.actual.inflowAmount)}</span>
                      <span>Gider {formatMoney(period.actual.outflowAmount)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className={styles.legend} aria-hidden="true">
              <span><i className={styles.inflowKey} /> Gelir</span>
              <span><i className={styles.outflowKey} /> Gider</span>
            </div>
          </section>

          <p className={styles.tableHint} id="cash-flow-table-hint" role="note">
            Tablonun tüm sütunlarını görmek için yatay kaydırın.
          </p>
          <div
            className={styles.tableFrame}
            role="region"
            aria-describedby="cash-flow-table-hint"
            aria-label="Nakit akışı dönem detayları"
            tabIndex={0}
          >
            <table>
              <caption>
                Dönemlere göre açılış, yeni hesap bakiyesi, gelir, gider, net
                akış, kapanış ve tahmin
              </caption>
              <thead>
                <tr>
                  <th scope="col">Dönem</th>
                  <th scope="col">Açılış</th>
                  <th scope="col">Yeni hesap açılışı</th>
                  <th scope="col">Gelir</th>
                  <th scope="col">Gider</th>
                  <th scope="col">Net akış</th>
                  <th scope="col">Kapanış</th>
                  <th scope="col">Planlanan net</th>
                  <th scope="col">Dönemde gecikmiş net</th>
                </tr>
              </thead>
              <tbody>
                {payload.periods.map((period) => (
                  <tr key={period.startOn}>
                    <th scope="row">{formatPeriod(period)}</th>
                    <td data-label="Açılış">{formatMoney(period.openingBalanceAmount)}</td>
                    <td data-label="Yeni hesap açılışı">
                      {formatMoney(period.accountOpeningAmount)}
                    </td>
                    <td data-label="Gelir" className={styles.inflowCell}>
                      {formatMoney(period.actual.inflowAmount)}
                    </td>
                    <td data-label="Gider" className={styles.outflowCell}>
                      {formatMoney(period.actual.outflowAmount)}
                    </td>
                    <td data-label="Net akış" className={tone(period.actual.netAmount)}>
                      {formatMoney(period.actual.netAmount)}
                    </td>
                    <td data-label="Kapanış">{formatMoney(period.closingBalanceAmount)}</td>
                    <td
                      data-label="Planlanan net"
                      className={tone(period.forecast.scheduled.netAmount)}
                    >
                      {formatMoney(period.forecast.scheduled.netAmount)}
                    </td>
                    <td
                      data-label="Dönemde gecikmiş net"
                      className={tone(period.forecast.overdue.netAmount)}
                    >
                      {formatMoney(period.forecast.overdue.netAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Dönem toplamı</th>
                  <td>{formatMoney(payload.balance.openingBalanceAmount)}</td>
                  <td>{formatMoney(payload.balance.accountOpeningAmount)}</td>
                  <td className={styles.inflowCell}>{formatMoney(payload.actual.inflowAmount)}</td>
                  <td className={styles.outflowCell}>{formatMoney(payload.actual.outflowAmount)}</td>
                  <td className={tone(payload.actual.netAmount)}>{formatMoney(payload.actual.netAmount)}</td>
                  <td>{formatMoney(payload.balance.closingBalanceAmount)}</td>
                  <td className={tone(payload.forecast.scheduled.netAmount)}>
                    {formatMoney(payload.forecast.scheduled.netAmount)}
                  </td>
                  <td className={tone(payload.forecast.overdueInRange.netAmount)}>
                    {formatMoney(payload.forecast.overdueInRange.netAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={styles.watchlist}>
            <article>
              <span>Planlanan giriş</span>
              <strong>{formatMoney(payload.forecast.scheduled.inflowAmount)}</strong>
              <small>Seçilen aralıktaki açık tahsilat ve katkılar</small>
            </article>
            <article>
              <span>Planlanan çıkış</span>
              <strong>{formatMoney(payload.forecast.scheduled.outflowAmount)}</strong>
              <small>Seçilen aralıktaki taksit ve ileri tarihli giderler</small>
            </article>
            <article>
              <span>Tüm açık gecikmiş net</span>
              <strong className={tone(payload.forecast.overdue.netAmount)}>
                {formatMoney(payload.forecast.overdue.netAmount)}
              </strong>
              <small>Seçili aralıktan önce doğanlar dahil, bugün açık kalan vadeli kalemler</small>
            </article>
            <article>
              <span>Tarihi belirsiz komisyon</span>
              <strong>{formatMoney(payload.forecast.undatedInflowAmount)}</strong>
              <small>Ödeme günü bulunmadığı için dönemlere dağıtılmadı</small>
            </article>
            <article>
              <span>Sınıflandırılmamış gider</span>
              <strong>{formatMoney(payload.unclassifiedExpenses.amount)}</strong>
              <small>{payload.unclassifiedExpenses.entryCount} “diğer” ödeme kaydı</small>
            </article>
          </div>

          <details className={styles.assumptions}>
            <summary>Hesaplama ve kapsam notları</summary>
            <ul>
              {payload.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </section>
  );
}
