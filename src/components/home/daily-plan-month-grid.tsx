"use client";

import type { ReactNode } from "react";

import styles from "./daily-plan-month-grid.module.css";

export type DailyPlanMonthVisitStatus =
  | "planned"
  | "completed"
  | "makeup_pending"
  | "cancelled_by_agreement";

export type DailyPlanMonthVisit = Readonly<{
  committedOn: string;
  contractId: string;
  customerCode: string;
  customerId: string;
  customerName: string;
  internalPlannedAtUtc: string | null;
  resolutionStatus: DailyPlanMonthVisitStatus;
  visitId: string;
}>;

export type DailyPlanMonthTask = Readonly<{
  calendarOn: string;
  calendarSource: "visit" | "due_date";
  customerName: string | null;
  dueOn: string;
  id: string;
  linkedVisitId: string | null;
  projectName: string | null;
  status: "backlog" | "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  title: string;
}>;

type DailyPlanMonthGridProps = Readonly<{
  endDate: string;
  onOpenDay: (date: string) => void;
  renderVisitAction?: (visit: DailyPlanMonthVisit) => ReactNode;
  startDate: string;
  tasks?: readonly DailyPlanMonthTask[];
  today: string;
  visits: readonly DailyPlanMonthVisit[];
}>;

type CalendarDay = Readonly<{
  date: string;
  tasks: readonly DailyPlanMonthTask[];
  visits: readonly DailyPlanMonthVisit[];
}>;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const weekDays = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;

const fullDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("tr-TR", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const visitTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

const visitStatusLabels: Readonly<Record<DailyPlanMonthVisitStatus, string>> = {
  cancelled_by_agreement: "İptal",
  completed: "Tamamlandı",
  makeup_pending: "Telafi",
  planned: "Planlandı",
};

function dateAtNoonUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function shiftDate(value: string, days: number): string {
  const date = dateAtNoonUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function visitTime(value: string | null): string {
  if (value === null) return "Saat yok";
  const date = databaseUtcDate(value);
  return date === null ? "Saat yok" : visitTimeFormatter.format(date);
}

function calendarWeeks(
  startDate: string,
  endDate: string,
  visits: readonly DailyPlanMonthVisit[],
  tasks: readonly DailyPlanMonthTask[],
): readonly (readonly (CalendarDay | null)[])[] {
  const visitsByDate = new Map<string, DailyPlanMonthVisit[]>();
  const tasksByDate = new Map<string, DailyPlanMonthTask[]>();
  for (const visit of visits) {
    const dayVisits = visitsByDate.get(visit.committedOn) ?? [];
    dayVisits.push(visit);
    visitsByDate.set(visit.committedOn, dayVisits);
  }
  for (const task of tasks) {
    const dayTasks = tasksByDate.get(task.calendarOn) ?? [];
    dayTasks.push(task);
    tasksByDate.set(task.calendarOn, dayTasks);
  }

  const start = dateAtNoonUtc(startDate);
  const end = dateAtNoonUtc(endDate);
  const dayCount = Math.round((end.getTime() - start.getTime()) / DAY_MILLISECONDS) + 1;
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  const cells: (CalendarDay | null)[] = Array.from({ length: mondayOffset }, () => null);

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const date = shiftDate(startDate, dayIndex);
    cells.push({
      date,
      tasks: tasksByDate.get(date) ?? [],
      visits: visitsByDate.get(date) ?? [],
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (readonly (CalendarDay | null)[])[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function cellLabel(day: CalendarDay): string {
  const parts = [fullDateFormatter.format(dateAtNoonUtc(day.date))];
  if (day.visits.length > 0) parts.push(`${day.visits.length} ziyaret`);
  if (day.tasks.length > 0) parts.push(`${day.tasks.length} görev`);
  if (parts.length === 1) parts.push("plan yok");
  return parts.join(", ");
}

export function DailyPlanMonthGrid({
  endDate,
  onOpenDay,
  renderVisitAction,
  startDate,
  tasks = [],
  today,
  visits,
}: DailyPlanMonthGridProps) {
  const weeks = calendarWeeks(startDate, endDate, visits, tasks);
  const monthLabel = monthFormatter.format(dateAtNoonUtc(startDate));
  const hintId = `month-grid-hint-${startDate}`;

  return (
    <section className={styles.root} aria-labelledby={`month-grid-title-${startDate}`}>
      <div className={styles.heading}>
        <div>
          <p>Aylık takvim</p>
          <h3 id={`month-grid-title-${startDate}`}>{monthLabel}</h3>
        </div>
        <span>
          {visits.length} ziyaret · {tasks.length} görev
        </span>
      </div>
      <p className={styles.mobileHint} id={hintId}>
        Takvimin tamamını görmek için yatay kaydırın.
      </p>
      <div
        aria-describedby={hintId}
        aria-label={`${monthLabel} aylık plan takvimi`}
        className={styles.scrollArea}
        role="region"
        tabIndex={0}
      >
        <table className={styles.calendar}>
          <caption className={styles.screenReaderOnly}>{monthLabel} plan takvimi</caption>
          <thead>
            <tr>
              {weekDays.map((day) => (
                <th key={day} scope="col">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, weekIndex) => (
              <tr key={`${startDate}-week-${weekIndex + 1}`}>
                {week.map((day, dayIndex) =>
                  day === null ? (
                    <td
                      aria-label={`${weekDays[dayIndex]}, bu ayın dışında`}
                      className={styles.outsideMonth}
                      key={`${startDate}-empty-${weekIndex}-${dayIndex}`}
                    />
                  ) : (
                    <td
                      aria-label={cellLabel(day)}
                      className={day.date === today ? styles.today : undefined}
                      key={day.date}
                    >
                      <button
                        aria-label={`${fullDateFormatter.format(dateAtNoonUtc(day.date))} günlük görünümünü aç`}
                        className={styles.dayButton}
                        type="button"
                        onClick={() => onOpenDay(day.date)}
                      >
                        <time dateTime={day.date}>{Number(day.date.slice(-2))}</time>
                        {day.date === today ? <span>Bugün</span> : null}
                      </button>

                      {day.visits.length > 0 ? (
                        <ul className={styles.visits} aria-label="Ziyaretler">
                          {day.visits.map((visit) => (
                            <li
                              className={styles.visit}
                              data-status={visit.resolutionStatus}
                              id={`daily-plan-visit-${visit.visitId}`}
                              key={visit.visitId}
                              tabIndex={-1}
                            >
                              <div className={styles.visitHeading}>
                                <time>{visitTime(visit.internalPlannedAtUtc)}</time>
                                <span>{visitStatusLabels[visit.resolutionStatus]}</span>
                              </div>
                              <strong title={visit.customerName}>{visit.customerName}</strong>
                              <small>{visit.customerCode}</small>
                              {renderVisitAction ? (
                                <div className={styles.visitAction}>
                                  {renderVisitAction(visit)}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {day.tasks.length > 0 ? (
                        <ul className={styles.tasks} aria-label="Görevler">
                          {day.tasks.map((task) => (
                            <li data-status={task.status} key={task.id}>
                              <span aria-hidden="true" />
                              <strong title={task.title}>{task.title}</strong>
                              {task.customerName ?? task.projectName ? (
                                <small>
                                  {[task.customerName, task.projectName]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              ) : null}
                              <small className={styles.taskSource}>
                                {task.calendarSource === "visit"
                                  ? "Ziyarete bağlı"
                                  : "Vade günü"}
                              </small>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
