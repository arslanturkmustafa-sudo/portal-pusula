import type { ReactNode } from "react";
import styles from "./task-groups.module.css";

export type BypusulaTaskSource = {
  id: string;
  analysisId: string;
  companyName: string;
  programCode: string;
};

type GroupableTask = {
  id: string;
  description: string | null;
  bypusula?: BypusulaTaskSource | null;
};

export function TaskGroups<T extends GroupableTask>({ tasks, renderTask, expandMatches }: {
  tasks: readonly T[];
  renderTask: (task: T) => ReactNode;
  expandMatches: boolean;
}) {
  const analyses = new Map<string, { source: BypusulaTaskSource; tasks: T[] }>();
  const ordinary: T[] = [];
  for (const task of tasks) {
    if (!task.bypusula) { ordinary.push(task); continue; }
    const group = analyses.get(task.bypusula.id) ?? { source: task.bypusula, tasks: [] };
    group.tasks.push(task);
    analyses.set(task.bypusula.id, group);
  }
  const list = (items: readonly T[]) => <ul className="task-card-list">{items.map(task => <li key={task.id}>{renderTask(task)}</li>)}</ul>;
  return <>
    {ordinary.length > 0 && list(ordinary)}
    {[...analyses].map(([id, analysis]) => {
      const programs = new Map<string, T[]>();
      for (const task of analysis.tasks) {
        const code = task.bypusula!.programCode;
        programs.set(code, [...(programs.get(code) ?? []), task]);
      }
      return <details key={id} className={styles.analysis} open={expandMatches || undefined}>
        <summary><span className={styles.chevron} aria-hidden="true">›</span><span className={styles.heading}>
          <small>ByPusula · Analiz #{analysis.source.analysisId}</small>
          <strong>{analysis.source.companyName}</strong>
        </span><span className={styles.count}>{analysis.tasks.length}<span className="sr-only"> görev</span></span></summary>
        <div className={styles.programs}>{[...programs].map(([code, items]) => {
          // The durable task link determines grouping. Editable notes only supply a display label.
          const line = items.map(task => task.description?.split("\n").find(value => value.startsWith(`${code} — `))).find(Boolean);
          const title = line?.slice(code.length + 3) || code;
          return <details key={code} className={styles.program} open={expandMatches || undefined}>
            <summary><span className={styles.chevron} aria-hidden="true">›</span><span className={styles.heading}><strong>{title}</strong><small>{items.length} görev</small></span></summary>
            {list(items)}
          </details>;
        })}</div>
      </details>;
    })}
  </>;
}
