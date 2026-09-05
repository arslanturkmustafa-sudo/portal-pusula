"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";

import { DailyPlanVisitCompletion } from "./daily-plan-visit-completion";

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
  range: Readonly<{
    endDate: string;
    startDate: string;
  }>;
  view: PlanView;
}>;

type LoadState = "error" | "loading" | "ready";
type PlanView = "day" | "week" | "month";

type DailyPlanWorkspaceProps = Readonly<{
  canWriteVisits?: boolean;
}>;

const MIN_PLAN_DATE = "1000-01-01";
const MAX_PLAN_DATE = "9999-12-31";

const statusLabels: Readonly<Record<VisitResolutionStatus, string>> = {
  cancelled_by_agreement: "Mutabakatla iptal",
  completed: "Tamamlandı",
  makeup_pending: "Telafi bekliyor",
  planned: "Planlandı",
};

const viewLabels: Readonly<Record<PlanView, string>> = {
  day: "Günlük",
  month: "Aylık",
  week: "Haftalık",
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

function shiftMonth(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const targetMonthIndex = year * 12 + month - 1 + months;
  const minimumMonthIndex = 1000 * 12;
  const maximumMonthIndex = 9999 * 12 + 11;
  if (
    targetMonthIndex < minimumMonthIndex ||
    targetMonthIndex > maximumMonthIndex
  ) {
    return value;
  }

  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth, 0, 12),
  ).getUTCDate();
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function shiftPeriod(value: string, view: PlanView, direction: -1 | 1): string {
  if (view === "month") return shiftMonth(value, direction);
  return shiftDate(value, direction * (view === "week" ? 7 : 1));
}

function selectedDateLabel(value: string): string {
  return dateFormatter.format(dateAtNoonUtc(value));
}

function rangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return selectedDateLabel(startDate);
  return `${selectedDateLabel(startDate)} – ${selectedDateLabel(endDate)}`;
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

function statusClass(status: VisitResolutionStatus): string {
  return `daily-plan-status daily-plan-status-${status.replaceAll("_", "-")}`;
}

function VisitDetails({
  canWriteVisits,
  item,
  onCompleted,
}: Readonly<{
  canWriteVisits: boolean;
  item: DailyPlanItem;
  onCompleted: (visitId: string) => void;
}>) {
  const canComplete =
    canWriteVisits &&
    (item.resolutionStatus === "planned" ||
      item.resolutionStatus === "makeup_pending");

  return (
    <article
      className="daily-plan-entry"
      id={`daily-plan-visit-${item.visitId}`}
      tabIndex={-1}
    >
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
      {canComplete ? (
        <DailyPlanVisitCompletion
          onCompleted={onCompleted}
          target={{
            committedOn: item.committedOn,
            contractId: item.contractId,
            customerId: item.customerId,
            customerName: item.customerName,
            visitId: item.visitId,
          }}
        />
      ) : null}
    </article>
  );
}

function PlanDaySection({
  canWriteVisits,
  date,
  items,
  onCompleted,
}: Readonly<{
  canWriteVisits: boolean;
  date: string;
  items: readonly DailyPlanItem[];
  onCompleted: (visitId: string) => void;
}>) {
  const timedItems = items.filter(
    (item) => item.internalPlannedAtUtc !== null,
  );
  const untimedItems = items.filter(
    (item) => item.internalPlannedAtUtc === null,
  );
  const dateId = `daily-plan-date-${date}`;
  const timedId = `timed-visits-${date}`;
  const untimedId = `untimed-visits-${date}`;

  return (
    <section className="daily-plan-date-group" aria-labelledby={dateId}>
      <header className="daily-plan-date-heading">
        <h3 id={dateId}>{selectedDateLabel(date)}</h3>
        <span>{items.length} ziyaret</span>
      </header>

      {timedItems.length > 0 ? (
        <section className="daily-plan-group" aria-labelledby={timedId}>
          <header className="daily-plan-group-heading">
            <div>
              <p className="section-kicker">Zaman çizelgesi</p>
              <h4 id={timedId}>Saatli ziyaretler</h4>
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
                <VisitDetails
                  canWriteVisits={canWriteVisits}
                  item={item}
                  onCompleted={onCompleted}
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {untimedItems.length > 0 ? (
        <section className="daily-plan-group" aria-labelledby={untimedId}>
          <header className="daily-plan-group-heading">
            <div>
              <p className="section-kicker">Günlük havuz</p>
              <h4 id={untimedId}>Saat belirlenmedi</h4>
            </div>
            <span>{untimedItems.length} kayıt</span>
          </header>
          <ul className="daily-plan-untimed-list">
            {untimedItems.map((item) => (
              <li key={item.visitId}>
                <span className="daily-plan-untimed-label">Saat belirlenmedi</span>
                <VisitDetails
                  canWriteVisits={canWriteVisits}
                  item={item}
                  onCompleted={onCompleted}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

export function DailyPlanWorkspace({
  canWriteVisits = false,
}: DailyPlanWorkspaceProps) {
  const [selectedDate, setSelectedDate] = useState(() => istanbulDate());
  const [selectedView, setSelectedView] = useState<PlanView>("day");
  const [items, setItems] = useState<readonly DailyPlanItem[]>([]);
  const [loadedRange, setLoadedRange] = useState<DailyPlanPayload["range"] | null>(
    null,
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const today = useMemo(() => istanbulDate(), []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    const query = new URLSearchParams({ date: selectedDate });
    if (selectedView !== "day") query.set("view", selectedView);

    void fetch(`/api/daily-plan?${query.toString()}`, {
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
        if (
          payload.date !== selectedDate ||
          payload.view !== selectedView ||
          !Array.isArray(payload.items) ||
          typeof payload.range?.startDate !== "string" ||
          typeof payload.range?.endDate !== "string" ||
          payload.items.some(
            (item) =>
              item.committedOn < payload.range.startDate ||
              item.committedOn > payload.range.endDate,
          )
        ) {
          throw new Error("Daily plan response is invalid.");
        }
        setItems(payload.items);
        setLoadedRange(payload.range);
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
  }, [requestRevision, selectedDate, selectedView]);

  const days = useMemo(() => {
    const grouped = new Map<string, DailyPlanItem[]>();
    for (const item of items) {
      const dayItems = grouped.get(item.committedOn) ?? [];
      dayItems.push(item);
      grouped.set(item.committedOn, dayItems);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, dayItems]) => ({ date, items: dayItems }));
  }, [items]);
  const completedCount = items.filter(
    (item) => item.resolutionStatus === "completed",
  ).length;
  const isToday = selectedDate === today;
  const previousDate = shiftPeriod(selectedDate, selectedView, -1);
  const nextDate = shiftPeriod(selectedDate, selectedView, 1);
  const periodName =
    selectedView === "day"
      ? "Günün planı"
      : selectedView === "week"
        ? "Haftalık plan"
        : "Aylık plan";
  const navigationUnit =
    selectedView === "day" ? "gün" : selectedView === "week" ? "hafta" : "ay";

  function openDate(date: string) {
    if (date === selectedDate) return;
    setItems([]);
    setLoadedRange(null);
    setCompletionNotice(null);
    setLoadState("loading");
    setSelectedDate(date);
  }

  function openView(view: PlanView) {
    if (view === selectedView) return;
    setItems([]);
    setLoadedRange(null);
    setCompletionNotice(null);
    setLoadState("loading");
    setSelectedView(view);
  }

  function chooseDate(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.value !== "") openDate(event.target.value);
  }

  function markCompleted(visitId: string) {
    const completedItem = items.find((item) => item.visitId === visitId);
    setItems((current) =>
      current.map((item) =>
        item.visitId === visitId
          ? { ...item, resolutionStatus: "completed" }
          : item,
      ),
    );
    setCompletionNotice(
      completedItem
        ? `${completedItem.customerName} ziyareti tamamlandı.`
        : "Ziyaret tamamlandı.",
    );
    window.setTimeout(() => {
      document.getElementById(`daily-plan-visit-${visitId}`)?.focus();
    }, 0);
  }

  return (
    <section
      className="day-sheet day-page daily-plan-workspace"
      aria-labelledby="day-sheet-title"
    >
      <div className="section-heading daily-plan-heading">
        <div>
          <p className="section-kicker">
            {selectedView === "day" && isToday ? "Bugün" : viewLabels[selectedView]}
            {" / "}
            {loadedRange
              ? rangeLabel(loadedRange.startDate, loadedRange.endDate)
              : selectedDateLabel(selectedDate)}
          </p>
          <h2 id="day-sheet-title">{periodName}</h2>
        </div>

        <div className="daily-plan-controls">
          <div className="daily-plan-view-switch" role="group" aria-label="Plan görünümü">
            {(["day", "week", "month"] as const).map((view) => (
              <button
                aria-pressed={selectedView === view}
                key={view}
                type="button"
                onClick={() => openView(view)}
              >
                {viewLabels[view]}
              </button>
            ))}
          </div>
          <div className="daily-plan-toolbar" aria-label="Plan dönemini seçin">
            <button
              aria-label={`Önceki ${navigationUnit}`}
              className="daily-plan-day-button"
              disabled={previousDate === selectedDate}
              type="button"
              onClick={() => openDate(previousDate)}
            >
              <span aria-hidden="true">←</span> Önceki {navigationUnit}
            </button>
            <label className="daily-plan-date-field">
              <span>Odak tarihi</span>
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
              aria-label={`Sonraki ${navigationUnit}`}
              className="daily-plan-day-button"
              disabled={nextDate === selectedDate}
              type="button"
              onClick={() => openDate(nextDate)}
            >
              Sonraki {navigationUnit} <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>

      {loadState === "loading" ? (
        <p className="daily-plan-feedback" role="status">
          Planlanan ziyaretler yükleniyor…
        </p>
      ) : null}

      {loadState === "error" ? (
        <div className="daily-plan-feedback daily-plan-feedback-error" role="alert">
          <div>
            <strong>Plan görünümüne ulaşılamadı.</strong>
            <span>Bağlantıyı kontrol edip yeniden deneyin.</span>
          </div>
          <button
            className="daily-plan-retry"
            type="button"
            onClick={() => {
              setItems([]);
              setLoadedRange(null);
              setLoadState("loading");
              setRequestRevision((current) => current + 1);
            }}
          >
            Yeniden dene
          </button>
        </div>
      ) : null}

      {completionNotice ? (
        <p className="daily-plan-completion-notice" role="status">
          <span aria-hidden="true">✓</span>
          {completionNotice}
        </p>
      ) : null}

      {loadState === "ready" && items.length === 0 ? (
        <div className="daily-plan-empty" role="status">
          <span aria-hidden="true">00</span>
          <div>
            <strong>Bu dönem için planlanmış ziyaret bulunmuyor.</strong>
            <p>Başka bir tarih veya görünüm seçerek ziyaret akışını inceleyebilirsiniz.</p>
          </div>
        </div>
      ) : null}

      {loadState === "ready" && items.length > 0 ? (
        <>
          <div className="daily-plan-summary" aria-label="Dönem özeti">
            <span><strong>{items.length}</strong> ziyaret</span>
            <span><strong>{days.length}</strong> planlı gün</span>
            <span><strong>{completedCount}</strong> tamamlandı</span>
          </div>
          <div className="daily-plan-days">
            {days.map((day) => (
              <PlanDaySection
                canWriteVisits={canWriteVisits}
                date={day.date}
                items={day.items}
                key={day.date}
                onCompleted={markCompleted}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
