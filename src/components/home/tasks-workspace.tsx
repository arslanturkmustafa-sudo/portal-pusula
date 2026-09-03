"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { PortalPageHeader } from "@/components/portal/portal-page-header";

type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";
type TaskPriority = "low" | "normal" | "high" | "urgent";
type LoadState = "error" | "loading" | "ready";
type SaveState = "idle" | "saving";
type DueFilter = "all" | "today" | "overdue";

type TaskDto = Readonly<{
  assigneeEmail: string | null;
  assigneeUserAccountId: string | null;
  completedAtUtc: string | null;
  createdAtUtc: string;
  customerCode: string | null;
  customerId: string | null;
  customerName: string | null;
  description: string | null;
  dueOn: string | null;
  id: string;
  priority: TaskPriority;
  projectCode: string | null;
  projectId: string | null;
  projectName: string | null;
  status: TaskStatus;
  title: string;
  updatedAtUtc: string;
  version: number;
}>;

type CustomerDto = Readonly<{
  displayName: string;
  id: string;
  projects?: readonly Readonly<{
    id: string;
    status: ProjectDto["status"];
  }>[];
  shortCode: string;
  status: "active" | "inactive";
}>;

type ProjectDto = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
}>;

type TaskDraft = {
  customerId: string;
  description: string;
  dueOn: string;
  priority: TaskPriority;
  projectId: string;
  status: TaskStatus;
  title: string;
};

const statusDefinitions: readonly Readonly<{
  label: string;
  status: TaskStatus;
}>[] = [
  { label: "Havuz", status: "backlog" },
  { label: "Yapılacak", status: "todo" },
  { label: "Devam ediyor", status: "in_progress" },
  { label: "Beklemede", status: "blocked" },
  { label: "Tamamlandı", status: "done" },
];

const statusLabels: Readonly<Record<TaskStatus, string>> = Object.fromEntries(
  statusDefinitions.map((definition) => [definition.status, definition.label]),
) as Record<TaskStatus, string>;

const priorityLabels: Readonly<Record<TaskPriority, string>> = {
  high: "Yüksek",
  low: "Düşük",
  normal: "Normal",
  urgent: "Acil",
};

const priorityOrder: Readonly<Record<TaskPriority, number>> = {
  high: 1,
  low: 3,
  normal: 2,
  urgent: 0,
};

const dueDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Istanbul",
  year: "numeric",
});

function emptyDraft(): TaskDraft {
  return {
    customerId: "",
    description: "",
    dueOn: "",
    priority: "normal",
    projectId: "",
    status: "backlog",
    title: "",
  };
}

function taskDraft(task: TaskDto): TaskDraft {
  return {
    customerId: task.customerId ?? "",
    description: task.description ?? "",
    dueOn: task.dueOn ?? "",
    priority: task.priority,
    projectId: task.projectId ?? "",
    status: task.status,
    title: task.title,
  };
}

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

function dueDateLabel(value: string, today: string): string {
  if (value === today) return "Bugün";
  return dueDateFormatter.format(dateAtNoonUtc(value));
}

function isOverdue(task: TaskDto, today: string): boolean {
  return task.status !== "done" && task.dueOn !== null && task.dueOn < today;
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

function canonicalSearch(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function sortedTasks(tasks: readonly TaskDto[]): readonly TaskDto[] {
  return [...tasks].sort((left, right) => {
    const priorityDifference =
      priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    if (left.dueOn === null && right.dueOn !== null) return 1;
    if (left.dueOn !== null && right.dueOn === null) return -1;
    const dateDifference = (left.dueOn ?? "").localeCompare(right.dueOn ?? "");
    if (dateDifference !== 0) return dateDifference;
    return left.id.localeCompare(right.id);
  });
}

function taskBody(draft: TaskDraft) {
  const description = draft.description.trim();
  return {
    customerId: draft.customerId || null,
    description: description.length === 0 ? null : description,
    dueOn: draft.dueOn || null,
    priority: draft.priority,
    projectId: draft.projectId || null,
    status: draft.status,
    title: draft.title.trim(),
  };
}

function taskUpdateBody(draft: TaskDraft, task: TaskDto) {
  const next = taskBody(draft);
  return {
    ...(next.customerId === task.customerId ? {} : { customerId: next.customerId }),
    ...(next.description === task.description ? {} : { description: next.description }),
    ...(next.dueOn === task.dueOn ? {} : { dueOn: next.dueOn }),
    ...(next.priority === task.priority ? {} : { priority: next.priority }),
    ...(next.projectId === task.projectId ? {} : { projectId: next.projectId }),
    ...(next.status === task.status ? {} : { status: next.status }),
    ...(next.title === task.title ? {} : { title: next.title }),
    version: task.version,
  };
}

function taskBodyFromRecord(task: TaskDto, status: TaskStatus) {
  return {
    customerId: task.customerId,
    description: task.description,
    dueOn: task.dueOn,
    priority: task.priority,
    projectId: task.projectId,
    status,
    title: task.title,
    version: task.version,
  };
}

function statusClass(status: TaskStatus): string {
  return `task-column task-column-${status.replaceAll("_", "-")}`;
}

type TaskCardProps = Readonly<{
  editing: boolean;
  onEdit: (task: TaskDto) => void;
  onStatusChange: (task: TaskDto, status: TaskStatus) => void;
  registerCard: (id: string, element: HTMLElement | null) => void;
  task: TaskDto;
  today: string;
  updating: boolean;
}>;

function TaskCard({
  editing,
  onEdit,
  onStatusChange,
  registerCard,
  task,
  today,
  updating,
}: TaskCardProps) {
  const titleId = `task-title-${task.id}`;
  const overdue = isOverdue(task, today);

  return (
    <article
      aria-busy={updating || undefined}
      aria-labelledby={titleId}
      className={`task-card task-card-priority-${task.priority}`}
      ref={(element) => registerCard(task.id, element)}
      tabIndex={-1}
    >
      <div className="task-card-heading">
        <div>
          <h4 id={titleId}>{task.title}</h4>
          {task.projectName === null ? null : (
            <p className="task-card-project">
              <span className="sr-only">Proje: </span>
              {task.projectName}
              {task.projectCode === null ? null : ` · ${task.projectCode}`}
            </p>
          )}
          {task.customerName !== null ? (
            <p className="task-card-customer">
              {task.customerName}
              {task.customerCode === null ? null : (
                <span>{task.customerCode}</span>
              )}
            </p>
          ) : (
            <p className="task-card-customer task-card-customer-empty">
              Müşteri bağlantısı yok
            </p>
          )}
        </div>
        {task.priority === "normal" ? null : (
          <span className={`task-priority task-priority-${task.priority}`}>
            {priorityLabels[task.priority]}
          </span>
        )}
      </div>

      {task.description === null ? null : (
        <p className="task-card-description">{task.description}</p>
      )}

      <div className="task-card-meta">
        {task.dueOn === null ? (
          <span>Vade yok</span>
        ) : (
          <span className={overdue ? "task-due-overdue" : undefined}>
            <time dateTime={task.dueOn}>{dueDateLabel(task.dueOn, today)}</time>
            {overdue ? " · Gecikti" : null}
          </span>
        )}
        <span>v{task.version}</span>
      </div>

      <div className="task-card-actions">
        <label className="task-card-status-field">
          <span>Durum</span>
          <select
            aria-label={`${task.title} durumu`}
            disabled={updating}
            value={task.status}
            onChange={(event) =>
              onStatusChange(task, event.target.value as TaskStatus)
            }
          >
            {statusDefinitions.map((definition) => (
              <option key={definition.status} value={definition.status}>
                {definition.label}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-controls="task-editor"
          aria-expanded={editing}
          aria-label={`${task.title} görevini düzenle`}
          className="task-card-edit"
          disabled={updating}
          type="button"
          onClick={() => onEdit(task)}
        >
          Düzenle
        </button>
      </div>
    </article>
  );
}

export function TasksWorkspace() {
  const [tasks, setTasks] = useState<readonly TaskDto[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerDto[]>([]);
  const [projects, setProjects] = useState<readonly ProjectDto[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("todo");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const taskCardRefs = useRef(new Map<string, HTMLElement>());
  const today = useMemo(() => istanbulDate(), []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    void (async () => {
      const tasksResponse = await fetch("/api/tasks", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const customersResponse = await fetch("/api/customers", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const projectsResponse = await fetch("/api/projects", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });

      return [tasksResponse, customersResponse, projectsResponse] as const;
    })()
      .then(async ([tasksResponse, customersResponse, projectsResponse]) => {
        if (
          tasksResponse.status === 401 ||
          customersResponse.status === 401 ||
          projectsResponse.status === 401
        ) {
          redirectToLogin();
          return null;
        }
        if (!tasksResponse.ok || !customersResponse.ok || !projectsResponse.ok) {
          throw new Error("Task workspace is unavailable.");
        }
        const [taskPayload, customerPayload, projectPayload] = (await Promise.all([
          tasksResponse.json(),
          customersResponse.json(),
          projectsResponse.json(),
        ])) as [
          { tasks?: TaskDto[] },
          { customers?: CustomerDto[] },
          { projects?: ProjectDto[] },
        ];
        if (
          !Array.isArray(taskPayload.tasks) ||
          !Array.isArray(customerPayload.customers) ||
          !Array.isArray(projectPayload.projects)
        ) {
          throw new Error("Task workspace response is invalid.");
        }
        return {
          customers: customerPayload.customers,
          projects: projectPayload.projects,
          tasks: taskPayload.tasks,
        };
      })
      .then((payload) => {
        if (!current || payload === null) return;
        setTasks(payload.tasks);
        setCustomers(payload.customers);
        setProjects(payload.projects);
        if (
          payload.tasks.length > 0 &&
          !payload.tasks.some((task) => task.status === "todo")
        ) {
          setMobileStatus(payload.tasks[0].status);
        }
        setBoardError(null);
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
  }, [requestRevision]);

  useEffect(() => {
    if (editorOpen) titleInputRef.current?.focus();
  }, [editingTask?.id, editorOpen]);

  useEffect(() => {
    if (focusTaskId === null) return;
    const card = taskCardRefs.current.get(focusTaskId);
    if (card === undefined) return;
    card.focus();
    setFocusTaskId(null);
  }, [focusTaskId, mobileStatus, tasks]);

  const visibleTasks = useMemo(() => {
    const search = canonicalSearch(query);
    return tasks.filter((task) => {
      const matchesQuery =
        search.length === 0 ||
        canonicalSearch(task.title).includes(search) ||
        canonicalSearch(task.description ?? "").includes(search) ||
        canonicalSearch(task.customerName ?? "").includes(search) ||
        canonicalSearch(task.customerCode ?? "").includes(search) ||
        canonicalSearch(task.projectName ?? "").includes(search) ||
        canonicalSearch(task.projectCode ?? "").includes(search);
      const matchesDue =
        dueFilter === "all" ||
        (dueFilter === "today" && task.dueOn === today) ||
        (dueFilter === "overdue" && isOverdue(task, today));
      const matchesProject =
        projectFilter === "all" ||
        (projectFilter === "unassigned"
          ? task.projectId === null
          : task.projectId === projectFilter);
      return matchesQuery && matchesDue && matchesProject;
    });
  }, [dueFilter, projectFilter, query, tasks, today]);

  const editorProjects = useMemo(() => {
    if (draft.customerId === "") return projects;
    const customer = customers.find((item) => item.id === draft.customerId);
    if (customer?.projects === undefined) return projects;
    const linkedIds = new Set(customer.projects.map((project) => project.id));
    return projects.filter(
      (project) =>
        linkedIds.has(project.id) ||
        (editingTask?.customerId === draft.customerId &&
          editingTask.projectId === project.id),
    );
  }, [customers, draft.customerId, editingTask, projects]);

  const editorCustomers = useMemo(() => {
    if (draft.projectId === "") return customers;
    return customers.filter(
      (customer) =>
        customer.projects === undefined ||
        customer.projects.some((project) => project.id === draft.projectId) ||
        (editingTask?.projectId === draft.projectId &&
          editingTask.customerId === customer.id),
    );
  }, [customers, draft.projectId, editingTask]);

  const tasksByStatus = useMemo(
    () =>
      Object.fromEntries(
        statusDefinitions.map((definition) => [
          definition.status,
          sortedTasks(
            visibleTasks.filter((task) => task.status === definition.status),
          ),
        ]),
      ) as Record<TaskStatus, readonly TaskDto[]>,
    [visibleTasks],
  );

  function registerCard(id: string, element: HTMLElement | null) {
    if (element === null) taskCardRefs.current.delete(id);
    else taskCardRefs.current.set(id, element);
  }

  function openCreateEditor() {
    setDraft(emptyDraft());
    setEditingTask(null);
    setFormError(null);
    setSaveState("idle");
    setEditorOpen(true);
  }

  function openEditEditor(task: TaskDto) {
    setDraft(taskDraft(task));
    setEditingTask(task);
    setFormError(null);
    setSaveState("idle");
    setEditorOpen(true);
  }

  function closeEditor(returnFocus = true) {
    const editedId = editingTask?.id ?? null;
    setEditorOpen(false);
    setEditingTask(null);
    setFormError(null);
    setSaveState("idle");
    if (!returnFocus) return;
    if (editedId === null) createButtonRef.current?.focus();
    else setFocusTaskId(editedId);
  }

  function updateDraft(next: Partial<TaskDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = taskBody(draft);
    if (body.title.length === 0) {
      setFormError("Görev başlığı zorunludur.");
      return;
    }

    const existing = editingTask;
    const requestBody = existing === null ? body : taskUpdateBody(draft, existing);
    if (existing !== null && Object.keys(requestBody).length === 1) {
      setAnnouncement(`${existing.title} görevinde değişiklik yok.`);
      closeEditor(false);
      setFocusTaskId(existing.id);
      return;
    }
    setSaveState("saving");
    setFormError(null);
    setBoardError(null);
    try {
      const response = await fetch(
        existing === null ? "/api/tasks" : `/api/tasks/${existing.id}`,
        {
          body: JSON.stringify(requestBody),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: existing === null ? "POST" : "PATCH",
        },
      );
      if (response.status === 401) {
        setSaveState("idle");
        redirectToLogin();
        return;
      }
      const payload = (await response.json()) as {
        status?: string;
        task?: TaskDto;
      };
      if (!response.ok || payload.task === undefined) {
        setFormError(
          payload.status === "customer_project_mismatch"
            ? "Seçilen müşteri bu projeye bağlı değil. Müşteri veya proje seçimini değiştirin."
            : response.status === 409
              ? "Görev başka bir işlemde değişti. Sayfayı yenileyip yeniden deneyin."
            : payload.status === "validation_error"
              ? "Başlık, vade, öncelik ve durum alanlarını kontrol edin."
              : "Görev kaydedilemedi. Lütfen yeniden deneyin.",
        );
        setSaveState("idle");
        return;
      }

      const savedTask = payload.task;
      setTasks((current) => [
        ...current.filter((task) => task.id !== savedTask.id),
        savedTask,
      ]);
      if (existing === null) {
        setQuery("");
        setDueFilter("all");
        setProjectFilter("all");
      }
      if (
        projectFilter !== "all" &&
        (projectFilter === "unassigned"
          ? savedTask.projectId !== null
          : savedTask.projectId !== projectFilter)
      ) {
        setProjectFilter("all");
      }
      setMobileStatus(savedTask.status);
      setAnnouncement(
        existing === null
          ? `${savedTask.title} görevi ${statusLabels[savedTask.status]} sütununa eklendi.`
          : `${savedTask.title} görevi güncellendi.`,
      );
      setSaveState("idle");
      closeEditor(false);
      setFocusTaskId(savedTask.id);
    } catch {
      setFormError("Görev kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState("idle");
    }
  }

  async function changeTaskStatus(task: TaskDto, status: TaskStatus) {
    if (task.status === status || updatingTaskId !== null) return;
    setUpdatingTaskId(task.id);
    setBoardError(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        body: JSON.stringify(taskBodyFromRecord(task, status)),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const payload = (await response.json()) as {
        status?: string;
        task?: TaskDto;
      };
      if (!response.ok || payload.task === undefined) {
        setBoardError(
          payload.status === "customer_project_mismatch"
            ? "Bu müşteri artık görevin projesine bağlı değil. Müşteri veya proje bağlantısını düzeltip yeniden deneyin."
            : response.status === 409
            ? "Görev başka bir işlemde değişti. Panoyu yenileyip yeniden deneyin."
            : "Görev durumu değiştirilemedi. Lütfen yeniden deneyin.",
        );
        return;
      }

      const savedTask = payload.task;
      setTasks((current) =>
        current.map((item) => (item.id === savedTask.id ? savedTask : item)),
      );
      setMobileStatus(savedTask.status);
      setAnnouncement(
        `${savedTask.title} görevi ${statusLabels[savedTask.status]} sütununa taşındı.`,
      );
      setFocusTaskId(savedTask.id);
    } catch {
      setBoardError(
        "Görev durumu değiştirilemedi. Bağlantıyı kontrol edip yeniden deneyin.",
      );
    } finally {
      setUpdatingTaskId(null);
    }
  }

  return (
    <div className="tasks-page-workspace">
      <PortalPageHeader
        actions={(
          <button
            aria-controls="task-editor"
            aria-expanded={editorOpen}
            className="primary-action"
            disabled={saveState === "saving"}
            ref={createButtonRef}
            type="button"
            onClick={() => {
              if (editorOpen) closeEditor();
              else openCreateEditor();
            }}
          >
            {editorOpen ? "Formu kapat" : "+ Görev ekle"}
          </button>
        )}
        context="İş takibi"
        note="İşleri proje, müşteri, öncelik ve vade bilgisiyle beş aşamada takip edin."
        title="Görevler"
      />

      {editorOpen ? (
        <section
          className="task-editor"
          id="task-editor"
          aria-labelledby="task-editor-title"
        >
          <div className="task-editor-intro">
            <p className="section-kicker">
              {editingTask === null ? "Yeni kayıt" : "Görev düzenleme"}
            </p>
            <h2 id="task-editor-title">
              {editingTask === null ? "Görev ekle" : "Görevi güncelle"}
            </h2>
            <p>
              Görevi ilgili proje dosyasına bağlayın; gerekiyorsa müşteri ve vade ekleyin.
            </p>
          </div>
          <form onSubmit={submitTask}>
            <label className="task-editor-title-field">
              <span>Görev başlığı</span>
              <input
                maxLength={191}
                ref={titleInputRef}
                required
                value={draft.title}
                onChange={(event) => updateDraft({ title: event.target.value })}
              />
            </label>
            <label>
              <span>Proje</span>
              <select
                value={draft.projectId}
                onChange={(event) =>
                  updateDraft({ projectId: event.target.value })
                }
              >
                <option value="">Proje bağlantısı yok</option>
                {draft.projectId !== "" &&
                !projects.some((project) => project.id === draft.projectId) ? (
                  <option value={draft.projectId}>
                    {editingTask?.projectName ?? "Mevcut proje"}
                  </option>
                ) : null}
                {editorProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.displayName} · {project.shortCode}
                    {project.status === "completed" || project.status === "cancelled"
                      ? " (kapalı)"
                      : project.status === "on_hold"
                        ? " (beklemede)"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Müşteri</span>
              <select
                value={draft.customerId}
                onChange={(event) =>
                  updateDraft({ customerId: event.target.value })
                }
              >
                <option value="">Müşteri bağlantısı yok</option>
                {draft.customerId !== "" &&
                !customers.some((customer) => customer.id === draft.customerId) ? (
                  <option value={draft.customerId}>
                    {editingTask?.customerName ?? "Mevcut müşteri"}
                  </option>
                ) : null}
                {editorCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName} · {customer.shortCode}
                    {customer.status === "inactive" ? " (pasif)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Vade</span>
              <input
                max="9999-12-31"
                min="1000-01-01"
                type="date"
                value={draft.dueOn}
                onChange={(event) => updateDraft({ dueOn: event.target.value })}
              />
            </label>
            <label>
              <span>Öncelik</span>
              <select
                value={draft.priority}
                onChange={(event) =>
                  updateDraft({ priority: event.target.value as TaskPriority })
                }
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Durum</span>
              <select
                value={draft.status}
                onChange={(event) =>
                  updateDraft({ status: event.target.value as TaskStatus })
                }
              >
                {statusDefinitions.map((definition) => (
                  <option key={definition.status} value={definition.status}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-editor-description-field">
              <span>Açıklama</span>
              <textarea
                maxLength={4000}
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  updateDraft({ description: event.target.value })
                }
              />
            </label>
            <div className="task-editor-actions">
              <button
                className="text-action"
                disabled={saveState === "saving"}
                type="button"
                onClick={() => closeEditor()}
              >
                Vazgeç
              </button>
              <button
                className="primary-action"
                disabled={saveState === "saving"}
                type="submit"
              >
                {saveState === "saving"
                  ? "Kaydediliyor…"
                  : editingTask === null
                    ? "Görevi kaydet"
                    : "Değişiklikleri kaydet"}
              </button>
            </div>
            {formError === null ? null : (
              <p className="task-editor-error" role="alert">
                {formError}
              </p>
            )}
          </form>
        </section>
      ) : null}

      <section className="task-board-workspace" aria-labelledby="task-board-title">
        <div className="task-board-heading">
          <div>
            <p className="section-kicker">
              Kayıt / {String(tasks.length).padStart(2, "0")}
            </p>
            <h2 id="task-board-title">Görev panosu</h2>
          </div>
          <div className="task-board-tools" aria-label="Görev araçları">
            <label className="task-search-field">
              <span className="sr-only">Görev ara</span>
              <input
                placeholder="Görev, proje veya müşteri ara"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="task-project-filter">
              <span className="sr-only">Proje filtresi</span>
              <select
                aria-label="Proje filtresi"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="all">Tüm projeler</option>
                <option value="unassigned">Projesiz görevler</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="task-filter-set" aria-label="Vade filtresi">
              {([
                ["all", "Tümü"],
                ["today", "Bugün"],
                ["overdue", "Geciken"],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={dueFilter === value}
                  className={dueFilter === value ? "is-selected" : undefined}
                  key={value}
                  type="button"
                  onClick={() => setDueFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        {boardError === null ? null : (
          <div className="task-board-message task-board-message-error" role="alert">
            <span>{boardError}</span>
            <button
              type="button"
              onClick={() => {
                setLoadState("loading");
                setBoardError(null);
                setRequestRevision((current) => current + 1);
              }}
            >
              Panoyu yenile
            </button>
          </div>
        )}

        {loadState === "loading" ? (
          <p className="task-board-message" role="status">
            Görev panosu hazırlanıyor…
          </p>
        ) : null}

        {loadState === "error" ? (
          <div className="task-board-message task-board-message-error" role="alert">
            <span>Görev panosuna ulaşılamadı. Bağlantıyı kontrol edin.</span>
            <button
              type="button"
              onClick={() => {
                setLoadState("loading");
                setRequestRevision((current) => current + 1);
              }}
            >
              Yeniden dene
            </button>
          </div>
        ) : null}

        {loadState === "ready" && tasks.length === 0 ? (
          <div className="task-board-empty" role="status">
            <span aria-hidden="true">00</span>
            <div>
              <strong>Henüz görev kaydı yok.</strong>
              <p>İlk işi Havuz veya Yapılacak aşamasına ekleyerek başlayın.</p>
              <button className="text-action" type="button" onClick={openCreateEditor}>
                İlk görevi ekle
              </button>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && tasks.length > 0 && visibleTasks.length === 0 ? (
          <div className="task-board-empty task-board-filter-empty" role="status">
            <span aria-hidden="true">00</span>
            <div>
              <strong>Filtrelerle eşleşen görev yok.</strong>
              <p>Arama, proje veya vade filtresini temizleyerek tüm kayıtları açın.</p>
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  setQuery("");
                  setDueFilter("all");
                  setProjectFilter("all");
                }}
              >
                Filtreleri temizle
              </button>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && visibleTasks.length > 0 ? (
          <>
            <label className="task-mobile-stage-field">
              <span>Mobil aşama</span>
              <select
                aria-label="Gösterilen Kanban aşaması"
                aria-controls={`task-column-${mobileStatus}`}
                value={mobileStatus}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setMobileStatus(event.target.value as TaskStatus)
                }
              >
                {statusDefinitions.map((definition) => (
                  <option key={definition.status} value={definition.status}>
                    {definition.label} ({tasksByStatus[definition.status].length})
                  </option>
                ))}
              </select>
            </label>

            <div className="task-board-scroll">
              <div className="task-board-grid">
                {statusDefinitions.map((definition, index) => {
                  const columnTasks = tasksByStatus[definition.status];
                  const headingId = `task-column-${definition.status}-title`;
                  return (
                    <section
                      aria-labelledby={headingId}
                      className={statusClass(definition.status)}
                      data-mobile-visible={definition.status === mobileStatus}
                      id={`task-column-${definition.status}`}
                      key={definition.status}
                    >
                      <header className="task-column-heading">
                        <div>
                          <span aria-hidden="true">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <h3 id={headingId}>{definition.label}</h3>
                        </div>
                        <span aria-label={`${columnTasks.length} görev`}>
                          {String(columnTasks.length).padStart(2, "0")}
                        </span>
                      </header>
                      {columnTasks.length === 0 ? (
                        <p className="task-column-empty">Bu aşamada görev yok.</p>
                      ) : (
                        <ul className="task-card-list">
                          {columnTasks.map((task) => (
                            <li key={task.id}>
                              <TaskCard
                                editing={editingTask?.id === task.id && editorOpen}
                                onEdit={openEditEditor}
                                onStatusChange={(item, status) =>
                                  void changeTaskStatus(item, status)
                                }
                                registerCard={registerCard}
                                task={task}
                                today={today}
                                updating={updatingTaskId === task.id}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
