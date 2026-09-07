import type { DailyPlanMonthTask } from "./daily-plan-month-grid";

import styles from "./daily-plan-day-tasks.module.css";

type DailyPlanDayTasksProps = Readonly<{
  date: string;
  tasks: readonly DailyPlanMonthTask[];
}>;

const statusLabels: Readonly<Record<DailyPlanMonthTask["status"], string>> = {
  backlog: "Havuz",
  blocked: "Beklemede",
  cancelled: "İptal",
  done: "Tamamlandı",
  in_progress: "Devam ediyor",
  todo: "Yapılacak",
};

const dueDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function dateAtNoonUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function taskContext(task: DailyPlanMonthTask): string {
  return [task.customerName, task.projectName].filter(Boolean).join(" · ");
}

export function DailyPlanDayTasks({ date, tasks }: DailyPlanDayTasksProps) {
  if (tasks.length === 0) return null;

  const titleId = `daily-plan-tasks-${date}`;

  return (
    <section className={styles.root} aria-labelledby={titleId}>
      <header className={styles.sectionHeading}>
        <div>
          <p>Günlük işler</p>
          <h4 id={titleId}>Görevler</h4>
        </div>
        <span>{tasks.length} kayıt</span>
      </header>

      <ul className={styles.list}>
        {tasks.map((task) => {
          const context = taskContext(task);
          return (
            <li className={styles.item} data-status={task.status} key={task.id}>
              <div className={styles.itemHeading}>
                <strong>{task.title}</strong>
                <span className={styles.status}>{statusLabels[task.status]}</span>
              </div>
              <p className={styles.context}>
                {context === "" ? "Firma veya proje bağlantısı yok" : context}
              </p>
              <p className={styles.meta}>
                <span>
                  Vade:{" "}
                  <time dateTime={task.dueOn}>
                    {dueDateFormatter.format(dateAtNoonUtc(task.dueOn))}
                  </time>
                </span>
                <span className={styles.source}>
                  {task.calendarSource === "visit"
                    ? "Ziyarete bağlı"
                    : "Vade günü"}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
