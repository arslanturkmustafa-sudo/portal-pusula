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

type CashFlowForecastLine = Readonly<{
  amount: string;
  bucket: "overdue" | "scheduled" | "undated";
  direction: "inflow" | "outflow";
  entryCount: number;
  eventOn: string | null;
  kind:
    | "card_installment"
    | "commission_receivable"
     | "customer_receivable"
     | "direct_expense"
     | "partner_contribution"
     | "tax_payment";
}>;

type CashFlowDueItem = Readonly<{
  direction: "inflow" | "outflow";
  dueOn: string;
  id: string;
  kind:
    | "card_payment"
     | "customer_receivable"
     | "other_expense"
     | "partner_contribution"
     | "tax_payment";
  label: string;
  remainingAmount: string;
  settledAmount: string;
  sourceLabel: string | null;
  status:
    | "actual"
    | "overdue"
    | "partial"
    | "planned"
    | "scheduled"
    | "settled";
  totalAmount: string;
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
    currentAssetAmount: string;
    openingBalanceAmount: string;
    status: "configured" | "not_configured";
  }>;
  dueItems: readonly CashFlowDueItem[];
  forecast: Readonly<{
    lines: readonly CashFlowForecastLine[];
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
const CASH_FLOW_REQUEST_TIMEOUT_MS = 15_000;

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

function dueItemStatusLabel(item: CashFlowDueItem): string {
  if (item.kind === "other_expense") {
    return "Planlanan diğer ödeme";
  }
  if (item.status === "settled") {
    return item.direction === "inflow" ? "Alındı" : "Ödendi";
  }
  if (item.status === "partial") {
    return item.direction === "inflow" ? "Kısmen alındı" : "Kısmen ödendi";
  }
  if (item.status === "overdue") {
    return item.direction === "inflow"
      ? "Gecikmiş alacak"
      : "Gecikmiş ödeme";
  }
  return item.direction === "inflow" ? "Alınacak" : "Ödenecek";
}

function dueItemKindLabel(kind: CashFlowDueItem["kind"]): string {
  return {
    card_payment: "Kredi kartı",
    customer_receivable: "Müşteri alacağı",
    other_expense: "Diğer ödeme",
    partner_contribution: "Ortaklık katkısı",
    tax_payment: "Vergi",
  }[kind];
}

const dueItemStatusOrder: Readonly<Record<CashFlowDueItem["status"], number>> = {
  actual: 0,
  settled: 1,
  partial: 2,
  planned: 3,
  scheduled: 4,
  overdue: 5,
};

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
  const [state, setState] = useState<
    "error" | "forbidden" | "loading" | "ready" | "timeout"
  >("loading");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CASH_FLOW_REQUEST_TIMEOUT_MS);
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
        if (!timedOut && error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPayload(null);
        setState(timedOut ? "timeout" : "error");
      })
      .finally(() => window.clearTimeout(timeoutId));
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
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
  const dueItems = payload
    ? payload.dueItems
        .filter(
          (item) =>
            item.dueOn >= payload.range.from && item.dueOn <= payload.range.to,
        )
        .sort((left, right) => {
          const dateComparison = left.dueOn.localeCompare(right.dueOn);
          if (dateComparison !== 0) return dateComparison;
          const statusComparison =
            dueItemStatusOrder[left.status] - dueItemStatusOrder[right.status];
          if (statusComparison !== 0) return statusComparison;
          const directionComparison = left.direction.localeCompare(
            right.direction,
          );
          return directionComparison !== 0
            ? directionComparison
            : left.id.localeCompare(right.id);
        })
    : [];
  const carryoverNetAmount = payload
    ? new Decimal(payload.forecast.overdue.netAmount)
        .minus(payload.forecast.overdueInRange.netAmount)
        .toFixed(4)
    : "0.0000";
  let projectedBalance = new Decimal(
    payload?.balance.currentAssetAmount ?? "0",
  ).plus(carryoverNetAmount);
  const projectionByDueOn = new Map<string, string>();
  for (const item of dueItems) {
    if (item.status !== "actual" && item.status !== "settled") {
      projectedBalance =
        item.direction === "inflow"
          ? projectedBalance.plus(item.remainingAmount)
          : projectedBalance.minus(item.remainingAmount);
    }
    projectionByDueOn.set(item.dueOn, projectedBalance.toFixed(4));
  }
  const projectedDueItems = dueItems.map((item) => ({
    ...item,
    projectedBalanceAmount:
      projectionByDueOn.get(item.dueOn) ?? projectedBalance.toFixed(4),
  }));
  const endProjectedBalanceAmount = projectedBalance.toFixed(4);

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
            Hesap defteri hareketlerini dönemsel izleyin; alacak ve ödemelerin
            gerçekleşen veya beklenen durumunu vade tarihine göre görün.
          </p>
        </div>
      </header>

      <aside className={styles.scopeNotice} aria-label="Nakit akışı rapor kapsamı">
        <strong>İki ayrı görünüm</strong>
        <p>
          Üst bölüm hesap defterindeki gerçekleşen giriş ve çıkışları korur. Alt
          bölüm yalnız alacak ve tahsilatları, kredi kartlarının vade bazındaki
          toplam ödemelerini ve ileri tarihli diğer ödeme planlarını kategori ve
          tarih bazında
          gösterir; tek tek kredi kartı harcamaları burada listelenmez.
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
      {state === "error" || state === "timeout" ? (
        <div className={styles.message} role="alert">
          <span>
            {state === "timeout"
              ? "Hesaplama beklenenden uzun sürdü. Verileriniz değişmedi; yeniden deneyebilirsiniz."
              : "Nakit akışı hazırlanamadı."}
          </span>
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
              <dt>Hesaba işlenen gelir</dt>
              <dd>{formatMoney(payload.actual.inflowAmount)}</dd>
            </div>
            <div className={styles.outflow}>
              <dt>Hesaptan çıkan gider</dt>
              <dd>{formatMoney(payload.actual.outflowAmount)}</dd>
            </div>
            <div className={tone(payload.actual.netAmount)}>
              <dt>Hesap net akışı</dt>
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
                başlangıç bakiyesi ve hesap defterindeki net akışla uzlaştırılır.
                İç transferler toplam likiditeyi değiştirmez.
              </span>
            </div>
          )}

          <section className={styles.trend} aria-labelledby="cash-flow-trend-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className="eyebrow">Hesap defteri hareketleri</p>
                <h3 id="cash-flow-trend-title">Dönemsel hesap giriş / çıkışı</h3>
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

          <section aria-labelledby="cash-flow-movements-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className="eyebrow">Vade takibi</p>
                <h3 id="cash-flow-movements-title">Vade planı</h3>
              </div>
              <span>{projectedDueItems.length} vadeli kayıt</span>
            </div>
            <p className={styles.tableNote} id="cash-flow-movements-note" role="note">
              Alacaklar; kredi kartı borçları kart ve vade bazında toplam olarak;
              ileri tarihli diğer ödeme planları ise kategori ve tarih bazında
              gösterilir. Tekil kart
              harcamaları ve hesap defteri hareketleri burada tekrarlanmaz.
              Öngörü, bugünkü gerçek varlığa devreden gecikmiş açıkları ve bu
              aralıktaki kalan tutarları gün gün uygular. Kapanmış kayıtlar
              bakiyeye yeniden eklenmez. Tahsilat veya ödeme durumunu kapatmak
              gerçek varlığı tek başına değiştirmez; gerçek bakiye için ilgili
              hesap hareketi de Hesaplar bölümüne işlenmelidir.
            </p>
            <dl className={styles.projectionSummary}>
              <div>
                <dt>Gerçek varlık</dt>
                <dd>{formatMoney(payload.balance.currentAssetAmount)}</dd>
                <small>{formatDate(payload.generatedOn)} itibarıyla</small>
              </div>
              <div>
                <dt>Devreden gecikmiş açıklar</dt>
                <dd className={tone(carryoverNetAmount)}>
                  {formatMoney(carryoverNetAmount)}
                </dd>
                <small>Seçilen aralığın öncesinden</small>
              </div>
              <div>
                <dt>Dönem sonu öngörülen varlık</dt>
                <dd className={tone(endProjectedBalanceAmount)}>
                  {formatMoney(endProjectedBalanceAmount)}
                </dd>
                <small>Açık kalan tutarlar sonrası</small>
              </div>
            </dl>
            <div
              className={styles.tableFrame}
              role="region"
              aria-describedby="cash-flow-movements-note"
              aria-label="Vade planı tablosu"
              tabIndex={0}
            >
              <table className={styles.movementTable}>
                <caption>
                  Seçilen tarih aralığındaki vadesi gelen alacak ve ödemeler
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Vade</th>
                    <th scope="col">Kalem</th>
                    <th scope="col">Durum</th>
                    <th scope="col">Toplam</th>
                    <th scope="col">Alınan / ödenen</th>
                    <th scope="col">Kalan</th>
                    <th scope="col">Adım sonrası öngörülen varlık</th>
                  </tr>
                </thead>
                <tbody>
                  {projectedDueItems.map((item) => (
                    <tr key={item.id}>
                      <th data-label="Vade" scope="row">
                        <time dateTime={item.dueOn}>
                          {formatDate(item.dueOn)}
                        </time>
                      </th>
                      <td className={styles.movementCell} data-label="Kalem">
                        <strong>{item.label}</strong>
                        <small>
                          {dueItemKindLabel(item.kind)}
                          {item.sourceLabel ? ` · ${item.sourceLabel}` : ""}
                        </small>
                      </td>
                      <td className={styles.statusCell} data-label="Durum">
                        <span
                          className={`${styles.badge} ${styles[`status_${item.status}`]}`}
                        >
                          {dueItemStatusLabel(item)}
                        </span>
                      </td>
                      <td
                        className={`${styles.amountCell} ${styles.totalCell} ${
                          item.direction === "inflow"
                            ? styles.inflowCell
                            : styles.outflowCell
                        }`}
                        data-label="Toplam"
                      >
                        <span className={styles.mobileCellLabel}>Toplam</span>
                        {formatMoney(item.totalAmount)}
                      </td>
                      <td
                        className={`${styles.amountCell} ${styles.settledCell} ${
                          item.kind === "other_expense" && item.status === "actual"
                            ? styles.neutral
                            : item.direction === "inflow"
                              ? styles.inflowCell
                              : styles.outflowCell
                        }`}
                        data-label="Alınan / ödenen"
                      >
                        <span className={styles.mobileCellLabel}>Alınan / ödenen</span>
                        {item.kind === "other_expense" && item.status === "actual"
                          ? "—"
                          : formatMoney(item.settledAmount)}
                      </td>
                      <td
                        className={`${styles.amountCell} ${styles.remainingCell} ${
                          (item.kind === "other_expense" && item.status === "actual") ||
                          new Decimal(item.remainingAmount).isZero()
                            ? styles.neutral
                            : item.direction === "inflow"
                              ? styles.inflowCell
                              : styles.outflowCell
                        }`}
                        data-label="Kalan"
                      >
                        <span className={styles.mobileCellLabel}>Kalan</span>
                        {item.kind === "other_expense" && item.status === "actual"
                          ? "—"
                          : formatMoney(item.remainingAmount)}
                      </td>
                      <td
                        className={`${styles.projectionCell} ${tone(
                          item.projectedBalanceAmount,
                        )}`}
                        data-label="Öngörülen varlık"
                      >
                        <span className={styles.mobileCellLabel}>Öngörülen varlık</span>
                        {formatMoney(item.projectedBalanceAmount)}
                      </td>
                    </tr>
                  ))}
                  {projectedDueItems.length === 0 ? (
                    <tr>
                      <td className={styles.emptyMovement} colSpan={7}>
                        Seçilen tarih aralığında vadeli alacak, tahsilat veya
                        ödeme kaydı yok.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <div className={styles.watchlist}>
            <article>
              <span>Planlanan giriş</span>
              <strong>{formatMoney(payload.forecast.scheduled.inflowAmount)}</strong>
              <small>Seçilen aralıktaki açık tahsilat ve katkılar</small>
            </article>
            <article>
              <span>Planlanan çıkış</span>
              <strong>{formatMoney(payload.forecast.scheduled.outflowAmount)}</strong>
              <small>Seçilen aralıktaki kart vade toplamları ve diğer ödemeler</small>
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
