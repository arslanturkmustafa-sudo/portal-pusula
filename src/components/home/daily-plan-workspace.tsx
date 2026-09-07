"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";

import {
  DailyPlanMonthGrid,
  type DailyPlanMonthTask,
  type DailyPlanMonthVisit,
} from "./daily-plan-month-grid";
import { DailyPlanDayTasks } from "./daily-plan-day-tasks";
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
  locationLabel: string | null;
  resolutionStatus: VisitResolutionStatus;
  visitId: string;
}>;

type DailyPlanPayload = Readonly<{
  customers?: readonly Readonly<{
    code: string;
    id: string;
    name: string;
  }>[];
  date: string;
  items: readonly DailyPlanItem[];
  range: Readonly<{
    endDate: string;
    startDate: string;
  }>;
  tasks?: readonly DailyPlanMonthTask[];
  view: PlanView;
}>;

type LoadState = "error" | "loading" | "ready";
type PlanView = "day" | "week" | "month";

type DailyPlanWorkspaceProps = Readonly<{
  canWriteTasks?: boolean;
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

function canCompleteVisit(
  canWriteVisits: boolean,
  item: Pick<DailyPlanItem, "resolutionStatus">,
): boolean {
  return (
    canWriteVisits &&
    (item.resolutionStatus === "planned" ||
      item.resolutionStatus === "makeup_pending")
  );
}

function VisitDetails({
  canWriteTasks,
  canWriteVisits,
  item,
  onCompleted,
}: Readonly<{
  canWriteTasks: boolean;
  canWriteVisits: boolean;
  item: DailyPlanItem;
  onCompleted: (visitId: string) => void;
}>) {
  const canComplete = canCompleteVisit(canWriteVisits, item);

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
        {typeof item.locationLabel !== "string" ? null : (
          <span className="daily-plan-location">
            Konum · {item.locationLabel}
          </span>
        )}
      </p>
      {canComplete ? (
        <DailyPlanVisitCompletion
          canWriteTasks={canWriteTasks}
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
  canWriteTasks,
  canWriteVisits,
  date,
  items,
  onCompleted,
  tasks,
}: Readonly<{
  canWriteTasks: boolean;
  canWriteVisits: boolean;
  date: string;
  items: readonly DailyPlanItem[];
  onCompleted: (visitId: string) => void;
  tasks: readonly DailyPlanMonthTask[];
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
        <span>
          {items.length} ziyaret
          {tasks.length > 0 ? ` · ${tasks.length} görev` : ""}
        </span>
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
                  canWriteTasks={canWriteTasks}
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
                  canWriteTasks={canWriteTasks}
                  canWriteVisits={canWriteVisits}
                  item={item}
                  onCompleted={onCompleted}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DailyPlanDayTasks date={date} tasks={tasks} />
    </section>
  );
}

export function DailyPlanWorkspace({
  canWriteTasks = false,
  canWriteVisits = false,
}: DailyPlanWorkspaceProps) {
  const [selectedDate, setSelectedDate] = useState(() => istanbulDate());
  const [selectedView, setSelectedView] = useState<PlanView>("day");
  const [items, setItems] = useState<readonly DailyPlanItem[]>([]);
  const [tasks, setTasks] = useState<readonly DailyPlanMonthTask[]>([]);
  const [loadedRange, setLoadedRange] = useState<DailyPlanPayload["range"] | null>(
    null,
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [customerFilter, setCustomerFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [customerOptions, setCustomerOptions] = useState<
    readonly Readonly<{ code: string | null; id: string; name: string }>[]
  >([]);
  const completionFocusVisitIdRef = useRef<string | null>(null);
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
          ) ||
          (payload.tasks !== undefined && !Array.isArray(payload.tasks)) ||
          (payload.customers !== undefined &&
            (!Array.isArray(payload.customers) ||
              payload.customers.some(
                (customer) =>
                  typeof customer.id !== "string" ||
                  typeof customer.name !== "string" ||
                  typeof customer.code !== "string",
              ))) ||
          (payload.tasks ?? []).some(
            (task) =>
              task.calendarOn < payload.range.startDate ||
              task.calendarOn > payload.range.endDate,
          )
        ) {
          throw new Error("Daily plan response is invalid.");
        }
        setItems(payload.items);
        setTasks(payload.tasks ?? []);
        setCustomerOptions((current) => {
          const options = new Map(
            (payload.customers ?? current).map((item) => [item.id, item]),
          );
          for (const item of payload.items) {
            options.set(item.customerId, {
              code: item.customerCode,
              id: item.customerId,
              name: item.customerName,
            });
          }
          for (const task of payload.tasks ?? []) {
            if (task.customerId !== null && task.customerName !== null) {
              const existing = options.get(task.customerId);
              options.set(task.customerId, {
                code: existing?.code ?? null,
                id: task.customerId,
                name: task.customerName,
              });
            }
          }
          return [...options.values()].sort((left, right) =>
            left.name.localeCompare(right.name, "tr-TR"),
          );
        });
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

  useEffect(() => {
    if (loadState !== "ready") return;
    const focusVisitId = completionFocusVisitIdRef.current;
    if (focusVisitId === null) return;
    const target = document.getElementById(`daily-plan-visit-${focusVisitId}`);
    if (target === null) return;
    completionFocusVisitIdRef.current = null;
    target.focus({ preventScroll: true });
  }, [items, loadState]);

  const customerFilteredItems = useMemo(
    () =>
      customerFilter === ""
        ? items
        : items.filter((item) => item.customerId === customerFilter),
    [customerFilter, items],
  );
  const customerFilteredTasks = useMemo(
    () =>
      customerFilter === ""
        ? tasks
        : tasks.filter((task) => task.customerId === customerFilter),
    [customerFilter, tasks],
  );
  const locationOptions = useMemo(() => {
    const options = new Set<string>();
    for (const item of customerFilteredItems) {
      if (typeof item.locationLabel === "string") options.add(item.locationLabel);
    }
    for (const task of customerFilteredTasks) {
      if (typeof task.locationLabel === "string") options.add(task.locationLabel);
    }
    if (locationFilter !== "") options.add(locationFilter);
    return [...options].sort((left, right) => left.localeCompare(right, "tr-TR"));
  }, [customerFilteredItems, customerFilteredTasks, locationFilter]);
  const visibleItems = useMemo(
    () =>
      locationFilter === ""
        ? customerFilteredItems
        : customerFilteredItems.filter(
            (item) => item.locationLabel === locationFilter,
          ),
    [customerFilteredItems, locationFilter],
  );
  const visibleTasks = useMemo(
    () =>
      locationFilter === ""
        ? customerFilteredTasks
        : customerFilteredTasks.filter(
            (task) => task.locationLabel === locationFilter,
          ),
    [customerFilteredTasks, locationFilter],
  );
  const days = useMemo(() => {
    const grouped = new Map<
      string,
      { items: DailyPlanItem[]; tasks: DailyPlanMonthTask[] }
    >();
    for (const item of visibleItems) {
      const day = grouped.get(item.committedOn) ?? { items: [], tasks: [] };
      day.items.push(item);
      grouped.set(item.committedOn, day);
    }
    for (const task of visibleTasks) {
      const day = grouped.get(task.calendarOn) ?? { items: [], tasks: [] };
      day.tasks.push(task);
      grouped.set(task.calendarOn, day);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, day]) => ({ date, ...day }));
  }, [visibleItems, visibleTasks]);
  const completedCount = visibleItems.filter(
    (item) => item.resolutionStatus === "completed",
  ).length;
  const plannedDayCount = days.length;
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
  const selectedCustomer =
    customerOptions.find((customer) => customer.id === customerFilter) ?? null;
  const exportQuery =
    customerFilter === ""
      ? null
      : new URLSearchParams({
          customerId: customerFilter,
          date: selectedDate,
          view: selectedView,
        });
  if (exportQuery !== null && locationFilter !== "") {
    exportQuery.set("location", locationFilter);
  }

  function openDate(date: string) {
    if (date === selectedDate) return;
    setItems([]);
    setTasks([]);
    setLoadedRange(null);
    setCompletionNotice(null);
    setLoadState("loading");
    setSelectedDate(date);
  }

  function openView(view: PlanView) {
    if (view === selectedView) return;
    setItems([]);
    setTasks([]);
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
    setCompletionNotice(
      completedItem
        ? `${completedItem.customerName} ziyareti tamamlandı.`
        : "Ziyaret tamamlandı.",
    );
    completionFocusVisitIdRef.current = visitId;
    setLoadState("loading");
    setRequestRevision((current) => current + 1);
  }

  function openMonthDay(date: string) {
    setItems([]);
    setTasks([]);
    setLoadedRange(null);
    setCompletionNotice(null);
    setLoadState("loading");
    setSelectedDate(date);
    setSelectedView("day");
  }

  function renderMonthVisitAction(visit: DailyPlanMonthVisit) {
    if (!canCompleteVisit(canWriteVisits, visit)) return null;
    return (
      <DailyPlanVisitCompletion
        canWriteTasks={canWriteTasks}
        onCompleted={markCompleted}
        target={{
          committedOn: visit.committedOn,
          contractId: visit.contractId,
          customerId: visit.customerId,
          customerName: visit.customerName,
          visitId: visit.visitId,
        }}
      />
    );
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

      <div
        aria-label="Takvim filtreleri ve çıktılar"
        className="daily-plan-filter-bar"
      >
        <div className="daily-plan-filters">
          <label>
            <span>Müşteri</span>
            <select
              aria-label="Takvimi müşteriye göre filtrele"
              value={customerFilter}
              onChange={(event) => {
                setCustomerFilter(event.target.value);
                setLocationFilter("");
              }}
            >
              <option value="">Tüm müşteriler</option>
              {customerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.code ? ` · ${customer.code}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Konum</span>
            <select
              aria-label="Takvimi konuma göre filtrele"
              disabled={locationOptions.length === 0}
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
            >
              <option value="">Tüm konumlar</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="daily-plan-export-actions">
          {exportQuery === null ? (
            <span>Çıktı için bir müşteri seçin.</span>
          ) : (
            <>
              <a
                download
                href={`/api/daily-plan/export?${exportQuery.toString()}&format=ics`}
              >
                ICS indir
              </a>
              <a
                href={`/api/daily-plan/export?${exportQuery.toString()}&format=print`}
                rel="noreferrer"
                target="_blank"
              >
                Yazdırılabilir görünüm
              </a>
              <span className="sr-only">
                {selectedCustomer?.name ?? "Seçili müşteri"} için güvenli
                oturum içi çıktılar
              </span>
            </>
          )}
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
              setTasks([]);
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

      {loadState === "ready" &&
      selectedView !== "month" &&
      visibleItems.length === 0 &&
      visibleTasks.length === 0 ? (
        <div className="daily-plan-empty" role="status">
          <span aria-hidden="true">00</span>
          <div>
            <strong>Bu dönem için planlanmış ziyaret veya görev bulunmuyor.</strong>
            <p>Başka bir tarih veya görünüm seçerek plan akışını inceleyebilirsiniz.</p>
          </div>
        </div>
      ) : null}

      {loadState === "ready" &&
      (selectedView === "month" ||
        visibleItems.length > 0 ||
        visibleTasks.length > 0) ? (
        <>
          <div className="daily-plan-summary" aria-label="Dönem özeti">
            <span><strong>{visibleItems.length}</strong> ziyaret</span>
            <span><strong>{plannedDayCount}</strong> planlı gün</span>
            <span><strong>{completedCount}</strong> tamamlanan ziyaret</span>
            {visibleTasks.length > 0 ? (
              <span><strong>{visibleTasks.length}</strong> görev</span>
            ) : null}
          </div>
          {selectedView === "month" && loadedRange !== null ? (
            <DailyPlanMonthGrid
              endDate={loadedRange.endDate}
              onOpenDay={openMonthDay}
              renderVisitAction={renderMonthVisitAction}
              startDate={loadedRange.startDate}
              tasks={visibleTasks}
              today={today}
              visits={visibleItems}
            />
          ) : (
            <div className="daily-plan-days">
              {days.map((day) => (
                <PlanDaySection
                  canWriteTasks={canWriteTasks}
                  canWriteVisits={canWriteVisits}
                  date={day.date}
                  items={day.items}
                  key={day.date}
                  onCompleted={markCompleted}
                  tasks={day.tasks}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
