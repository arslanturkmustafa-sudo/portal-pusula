"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";

type VisitResolutionStatus =
  | "planned"
  | "completed"
  | "makeup_pending"
  | "cancelled_by_agreement";

type DailyPlanItem = Readonly<{
  committedOn: string;
  contractId: string;
  customerCode: string;
  customerId: string;
  customerName: string;
  internalDurationMinutes: number | null;
  internalPlannedAtUtc: string | null;
  resolutionStatus: VisitResolutionStatus;
  visitId: string;
}>;

type DailyPlanPayload = Readonly<{
  date: string;
  items: readonly DailyPlanItem[];
}>;

type LoadState = "error" | "loading" | "ready";

const MIN_PLAN_DATE = "1000-01-01";
const MAX_PLAN_DATE = "9999-12-31";

const statusLabels: Readonly<Record<VisitResolutionStatus, string>> = {
  cancelled_by_agreement: "Mutabakatla iptal",
  completed: "Tamamlandı",
  makeup_pending: "Telafi bekliyor",
  planned: "Planlandı",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Istanbul",
  weekday: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

function istanbulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateAtNoonUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function shiftDate(value: string, days: number): string {
  const date = dateAtNoonUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  if (date.getUTCFullYear() < 1000) return MIN_PLAN_DATE;
  if (date.getUTCFullYear() > 9999) return MAX_PLAN_DATE;
  const shifted = date.toISOString().slice(0, 10);
  if (shifted < MIN_PLAN_DATE) return MIN_PLAN_DATE;
  if (shifted > MAX_PLAN_DATE) return MAX_PLAN_DATE;
  return shifted;
}

function selectedDateLabel(value: string): string {
  return dateFormatter.format(dateAtNoonUtc(value));
}

function databaseUtcDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/u.exec(
    value,
  );
  if (!match) return null;

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

function timeRangeLabel(item: DailyPlanItem): string {
  if (item.internalPlannedAtUtc === null) return "Saat belirlenmedi";
  const start = databaseUtcDate(item.internalPlannedAtUtc);
  if (start === null) return "Saat bilgisi geçersiz";

  const startLabel = timeFormatter.format(start);
  if (item.internalDurationMinutes === null) return startLabel;
  const end = new Date(
    start.getTime() + item.internalDurationMinutes * 60 * 1000,
  );
  return `${startLabel}–${timeFormatter.format(end)}`;
}

function durationLabel(minutes: number | null): string {
  return minutes === null ? "Süre belirtilmedi" : `${minutes} dk`;
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

function statusClass(status: VisitResolutionStatus): string {
  return `daily-plan-status daily-plan-status-${status.replaceAll("_", "-")}`;
}

function VisitDetails({ item }: Readonly<{ item: DailyPlanItem }>) {
  return (
    <article className="daily-plan-entry">
      <div className="daily-plan-entry-heading">
        <div>
          <strong>{item.customerName}</strong>
          <span className="daily-plan-customer-code">{item.customerCode}</span>
        </div>
        <span className={statusClass(item.resolutionStatus)}>
          {statusLabels[item.resolutionStatus]}
        </span>
      </div>
      <p className="daily-plan-entry-meta">
        <span>{durationLabel(item.internalDurationMinutes)}</span>
        <span>Ziyaret</span>
      </p>
    </article>
  );
}

export function DailyPlanWorkspace() {
  const [selectedDate, setSelectedDate] = useState(() => istanbulDate());
  const [items, setItems] = useState<readonly DailyPlanItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const today = useMemo(() => istanbulDate(), []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    void fetch(`/api/daily-plan?date=${encodeURIComponent(selectedDate)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!response.ok) throw new Error("Daily plan is unavailable.");
        return (await response.json()) as DailyPlanPayload;
      })
      .then((payload) => {
        if (!current || payload === null) return;
        if (payload.date !== selectedDate || !Array.isArray(payload.items)) {
          throw new Error("Daily plan response is invalid.");
        }
        setItems(payload.items);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [requestRevision, selectedDate]);

  const timedItems = items.filter(
    (item) => item.internalPlannedAtUtc !== null,
  );
  const untimedItems = items.filter(
    (item) => item.internalPlannedAtUtc === null,
  );
  const isToday = selectedDate === today;

  function openDate(date: string) {
    if (date === selectedDate) return;
    setItems([]);
    setLoadState("loading");
    setSelectedDate(date);
  }

  function chooseDate(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.value !== "") openDate(event.target.value);
  }

  return (
    <section
      className="day-sheet day-page daily-plan-workspace"
      aria-labelledby="day-sheet-title"
    >
      <div className="section-heading daily-plan-heading">
        <div>
          <p className="section-kicker">
            {isToday ? "Bugün" : "Seçili gün"} / {selectedDateLabel(selectedDate)}
          </p>
          <h2 id="day-sheet-title">Günün planı</h2>
        </div>

        <div className="daily-plan-toolbar" aria-label="Plan tarihini seçin">
          <button
            className="daily-plan-day-button"
            disabled={selectedDate === MIN_PLAN_DATE}
            type="button"
            onClick={() => openDate(shiftDate(selectedDate, -1))}
          >
            <span aria-hidden="true">←</span> Önceki gün
          </button>
          <label className="daily-plan-date-field">
            <span>Tarih</span>
            <input
              aria-label="Plan tarihi"
              max={MAX_PLAN_DATE}
              min={MIN_PLAN_DATE}
              type="date"
              value={selectedDate}
              onChange={chooseDate}
            />
          </label>
          <button
            className="daily-plan-day-button"
            disabled={selectedDate === MAX_PLAN_DATE}
            type="button"
            onClick={() => openDate(shiftDate(selectedDate, 1))}
          >
            Sonraki gün <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      {loadState === "loading" ? (
        <p className="daily-plan-feedback" role="status">
          Günün ziyaretleri yükleniyor…
        </p>
      ) : null}

      {loadState === "error" ? (
        <div className="daily-plan-feedback daily-plan-feedback-error" role="alert">
          <div>
            <strong>Günlük plana ulaşılamadı.</strong>
            <span>Bağlantıyı kontrol edip yeniden deneyin.</span>
          </div>
          <button
            className="daily-plan-retry"
            type="button"
            onClick={() => {
              setItems([]);
              setLoadState("loading");
              setRequestRevision((current) => current + 1);
            }}
          >
            Yeniden dene
          </button>
        </div>
      ) : null}

      {loadState === "ready" && items.length === 0 ? (
        <div className="daily-plan-empty" role="status">
          <span aria-hidden="true">00</span>
          <div>
            <strong>Bu gün için planlanmış ziyaret bulunmuyor.</strong>
            <p>Başka bir günü seçerek ziyaret akışını inceleyebilirsiniz.</p>
          </div>
        </div>
      ) : null}

      {loadState === "ready" && timedItems.length > 0 ? (
        <section className="daily-plan-group" aria-labelledby="timed-visits-title">
          <header className="daily-plan-group-heading">
            <div>
              <p className="section-kicker">Zaman çizelgesi</p>
              <h3 id="timed-visits-title">Saatli ziyaretler</h3>
            </div>
            <span>{timedItems.length} kayıt</span>
          </header>
          <ol className="daily-plan-timeline">
            {timedItems.map((item) => (
              <li key={item.visitId}>
                <time dateTime={item.internalPlannedAtUtc ?? undefined}>
                  {timeRangeLabel(item)}
                </time>
                <span className="daily-plan-timeline-marker" aria-hidden="true" />
                <VisitDetails item={item} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {loadState === "ready" && untimedItems.length > 0 ? (
        <section className="daily-plan-group" aria-labelledby="untimed-visits-title">
          <header className="daily-plan-group-heading">
            <div>
              <p className="section-kicker">Günlük havuz</p>
              <h3 id="untimed-visits-title">Saat belirlenmedi</h3>
            </div>
            <span>{untimedItems.length} kayıt</span>
          </header>
          <ul className="daily-plan-untimed-list">
            {untimedItems.map((item) => (
              <li key={item.visitId}>
                <span className="daily-plan-untimed-label">Saat belirlenmedi</span>
                <VisitDetails item={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
