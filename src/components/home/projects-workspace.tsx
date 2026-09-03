"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { PortalPageHeader } from "@/components/portal/portal-page-header";

type ProjectType = "consulting" | "product" | "partnership" | "internal";
type ProjectStatus =
  | "planned"
  | "active"
  | "on_hold"
  | "completed"
  | "cancelled";
type LoadState = "error" | "loading" | "ready";
type SaveState = "idle" | "saving";
type EditorMode = "create" | "edit" | null;

export type ProjectDto = Readonly<{
  budgetAmount: string | null;
  closedAtUtc: string | null;
  createdAtUtc: string;
  currency: "TRY";
  displayName: string;
  id: string;
  internalNote: string | null;
  objective: string | null;
  projectType: ProjectType;
  shortCode: string;
  startsOn: string | null;
  status: ProjectStatus;
  targetEndsOn: string | null;
  updatedAtUtc: string;
  version: number;
}>;

type CustomerDto = Readonly<{
  displayName: string;
  id: string;
  projects: readonly Readonly<{ id: string }>[];
  shortCode: string;
  status: "active" | "inactive";
}>;

type ProjectDraft = {
  budgetAmount: string;
  displayName: string;
  internalNote: string;
  objective: string;
  projectType: ProjectType;
  shortCode: string;
  startsOn: string;
  status: ProjectStatus;
  targetEndsOn: string;
};

const typeLabels: Readonly<Record<ProjectType, string>> = {
  consulting: "Danışmanlık",
  internal: "İç çalışma",
  partnership: "Ortaklık",
  product: "Ürün",
};

const statusLabels: Readonly<Record<ProjectStatus, string>> = {
  active: "Aktif",
  cancelled: "İptal",
  completed: "Tamamlandı",
  on_hold: "Beklemede",
  planned: "Planlandı",
};

const initialPortfolio: readonly Readonly<{
  displayName: string;
  objective: string;
  projectType: ProjectType;
  shortCode: string;
}>[] = [
  {
    displayName: "Mühendis Kafası",
    objective: "Eğitim ve danışmanlık müşteri çalışmalarını yönetmek.",
    projectType: "consulting",
    shortCode: "MUHENDIS_KAFASI",
  },
  {
    displayName: "ByPusula",
    objective: "İşletme olgunluğunu değerlendiren ve gelişime rehberlik eden ürünü büyütmek.",
    projectType: "product",
    shortCode: "BYPUSULA",
  },
  {
    displayName: "OptiPusula",
    objective: "Dağıtım ağı ve aktarım merkezi lokasyonlarını optimize eden ürünü geliştirmek.",
    projectType: "product",
    shortCode: "OPTIPUSULA",
  },
  {
    displayName: "7 Emlak Ajansı",
    objective: "Ortaklık kapsamındaki satış, kiralama ve pay süreçlerini izlemek.",
    projectType: "partnership",
    shortCode: "7_EMLAK",
  },
];

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Istanbul",
  year: "numeric",
});

function emptyDraft(): ProjectDraft {
  return {
    budgetAmount: "",
    displayName: "",
    internalNote: "",
    objective: "",
    projectType: "consulting",
    shortCode: "",
    startsOn: "",
    status: "active",
    targetEndsOn: "",
  };
}

function projectDraft(project: ProjectDto): ProjectDraft {
  return {
    budgetAmount:
      project.budgetAmount === null
        ? ""
        : editableMoney(project.budgetAmount),
    displayName: project.displayName,
    internalNote: project.internalNote ?? "",
    objective: project.objective ?? "",
    projectType: project.projectType,
    shortCode: project.shortCode,
    startsOn: project.startsOn ?? "",
    status: project.status,
    targetEndsOn: project.targetEndsOn ?? "",
  };
}

function editableMoney(value: string): string {
  const [integer, fraction] = value.split(".", 2);
  if (fraction === undefined) return integer;
  const significantFraction = fraction.replace(/0+$/u, "");
  return significantFraction.length === 0
    ? integer
    : `${integer}.${significantFraction}`;
}

function projectBody(draft: ProjectDraft) {
  const nullable = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  };
  return {
    budgetAmount: nullable(draft.budgetAmount.replace(",", ".")),
    displayName: draft.displayName.trim(),
    internalNote: nullable(draft.internalNote),
    objective: nullable(draft.objective),
    projectType: draft.projectType,
    shortCode: draft.shortCode.trim().toUpperCase(),
    startsOn: draft.startsOn || null,
    status: draft.status,
    targetEndsOn: draft.targetEndsOn || null,
  };
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

function dateLabel(value: string | null): string {
  if (value === null) return "Belirlenmedi";
  const [year, month, day] = value.split("-").map(Number);
  return dateFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function budgetLabel(value: string | null): string {
  if (value === null) return "Henüz tanımlanmadı";
  const [integer, fraction = ""] = value.split(".", 2);
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  const canonicalFraction = fraction.padEnd(4, "0").slice(0, 4);
  const visibleFraction = `${canonicalFraction.slice(0, 2)}${canonicalFraction
    .slice(2)
    .replace(/0+$/u, "")}`;
  return `₺${groupedInteger},${visibleFraction}`;
}

export function ProjectsWorkspace() {
  const [projects, setProjects] = useState<readonly ProjectDto[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerDto[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [draft, setDraft] = useState<ProjectDraft>(() => emptyDraft());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const [initializing, setInitializing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void Promise.all([
      fetch("/api/projects", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }),
      fetch("/api/customers", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }),
    ])
      .then(async ([projectsResponse, customersResponse]) => {
        if (projectsResponse.status === 401 || customersResponse.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!projectsResponse.ok || !customersResponse.ok) {
          throw new Error("Project workspace is unavailable.");
        }
        const [projectPayload, customerPayload] = (await Promise.all([
          projectsResponse.json(),
          customersResponse.json(),
        ])) as [
          { projects?: ProjectDto[] },
          { customers?: CustomerDto[] },
        ];
        if (
          !Array.isArray(projectPayload.projects) ||
          !Array.isArray(customerPayload.customers)
        ) {
          throw new Error("Project workspace response is invalid.");
        }
        return {
          customers: customerPayload.customers,
          projects: projectPayload.projects,
        };
      })
      .then((payload) => {
        if (!current || payload === null) return;
        setProjects(payload.projects);
        setCustomers(payload.customers);
        setSelectedProjectId((existing) =>
          payload.projects.some((project) => project.id === existing)
            ? existing
            : (payload.projects[0]?.id ?? null),
        );
        if (
          initialPortfolio.every((item) =>
            payload.projects.some(
              (project) => project.shortCode === item.shortCode,
            ),
          )
        ) {
          setInitializationError(null);
        }
        setError(null);
        setLoadState("ready");
      })
      .catch((fetchError: unknown) => {
        if (!current) return;
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        setLoadState("error");
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [requestRevision]);

  useEffect(() => {
    if (editorMode !== null) nameInputRef.current?.focus();
  }, [editorMode]);

  const portfolioCounts = useMemo(
    () => ({
      active: projects.filter((project) => project.status === "active").length,
      product: projects.filter((project) => project.projectType === "product")
        .length,
      total: projects.length,
    }),
    [projects],
  );
  const missingInitialProjects = useMemo(
    () =>
      initialPortfolio.filter(
        (item) => !projects.some((project) => project.shortCode === item.shortCode),
      ),
    [projects],
  );
  const selectedProjectCustomers = useMemo(
    () =>
      selectedProject === null
        ? []
        : customers.filter((customer) =>
            customer.projects.some((project) => project.id === selectedProject.id),
          ),
    [customers, selectedProject],
  );

  function customerCount(projectId: string): number {
    return customers.filter((customer) =>
      customer.projects.some((project) => project.id === projectId),
    ).length;
  }

  function openCreateEditor() {
    setDraft(emptyDraft());
    setEditorMode("create");
    setError(null);
  }

  function openEditEditor() {
    if (selectedProject === null) return;
    setDraft(projectDraft(selectedProject));
    setEditorMode("edit");
    setError(null);
  }

  function closeEditor() {
    setEditorMode(null);
    setSaveState("idle");
    setError(null);
  }

  function updateDraft(next: Partial<ProjectDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = projectBody(draft);
    if (body.displayName.length === 0 || body.shortCode.length === 0) {
      setError("Proje adı ve kısa kod zorunludur.");
      return;
    }
    if (
      body.startsOn !== null &&
      body.targetEndsOn !== null &&
      body.targetEndsOn < body.startsOn
    ) {
      setError("Hedef bitiş tarihi başlangıç tarihinden önce olamaz.");
      return;
    }

    const existing = editorMode === "edit" ? selectedProject : null;
    setSaveState("saving");
    setError(null);
    try {
      const response = await fetch(
        existing === null ? "/api/projects" : `/api/projects/${existing.id}`,
        {
          body: JSON.stringify(
            existing === null ? body : { ...body, version: existing.version },
          ),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: existing === null ? "POST" : "PATCH",
        },
      );
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const payload = (await response.json()) as {
        project?: ProjectDto;
        status?: string;
      };
      if (!response.ok || payload.project === undefined) {
        setError(
          response.status === 409
            ? payload.status === "short_code_conflict"
              ? "Bu kısa kod başka bir projede kullanılıyor."
              : "Proje başka bir işlemde değişti. Sayfayı yenileyip yeniden deneyin."
            : payload.status === "validation_error"
              ? "Proje bilgilerini ve tarih aralığını kontrol edin."
              : "Proje kaydedilemedi. Lütfen yeniden deneyin.",
        );
        setSaveState("idle");
        return;
      }
      const savedProject = payload.project;
      setProjects((current) =>
        existing === null
          ? [...current, savedProject]
          : current.map((project) =>
              project.id === savedProject.id ? savedProject : project,
            ),
      );
      setSelectedProjectId(savedProject.id);
      setAnnouncement(
        existing === null
          ? `${savedProject.displayName} projesi eklendi.`
          : `${savedProject.displayName} projesi güncellendi.`,
      );
      setSaveState("idle");
      setEditorMode(null);
    } catch {
      setError("Proje kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState("idle");
    }
  }

  async function initializePortfolio() {
    if (initializing || missingInitialProjects.length === 0) return;
    setInitializing(true);
    setInitializationError(null);
    const created: ProjectDto[] = [];
    let requiresRefresh = false;
    try {
      for (const item of missingInitialProjects) {
        const response = await fetch("/api/projects", {
          body: JSON.stringify({
            ...item,
            budgetAmount: null,
            internalNote: null,
            startsOn: null,
            status: "active",
            targetEndsOn: null,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (response.status === 401) {
          redirectToLogin();
          return;
        }
        const payload = (await response.json()) as {
          project?: ProjectDto;
          status?: string;
        };
        if (
          response.status === 409 &&
          payload.status === "short_code_conflict"
        ) {
          requiresRefresh = true;
          continue;
        }
        if (!response.ok || payload.project === undefined) {
          throw new Error("Portfolio initialization failed.");
        }
        created.push(payload.project);
      }
      if (requiresRefresh) {
        const response = await fetch("/api/projects", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          redirectToLogin();
          return;
        }
        const payload = (await response.json()) as { projects?: ProjectDto[] };
        if (!response.ok || !Array.isArray(payload.projects)) {
          throw new Error("Portfolio refresh failed.");
        }
        setProjects(payload.projects);
        setSelectedProjectId((current) =>
          payload.projects?.some((project) => project.id === current)
            ? current
            : (payload.projects?.[0]?.id ?? null),
        );
      } else {
        setProjects((current) => [...current, ...created]);
        setSelectedProjectId((current) => current ?? created[0]?.id ?? null);
      }
      setInitializationError(null);
      setAnnouncement("Başlangıç portföyü tamamlandı.");
    } catch {
      if (created.length > 0) {
        setProjects((current) => [...current, ...created]);
        setSelectedProjectId((current) => current ?? created[0]?.id ?? null);
      }
      setInitializationError(
        "Başlangıç portföyü tamamlanamadı. Oluşan kayıtlar korundu; eksik projeleri yeniden deneyin.",
      );
    } finally {
      setInitializing(false);
    }
  }

  return (
    <div className="projects-page-workspace">
      <PortalPageHeader
        actions={(
          <button
            className="primary-action"
            disabled={saveState === "saving" || initializing}
            type="button"
            onClick={() => (editorMode === null ? openCreateEditor() : closeEditor())}
          >
            {editorMode === null ? "+ Proje ekle" : "Formu kapat"}
          </button>
        )}
        context="İş portföyü"
        note="Danışmanlık, ürün ve ortaklık çalışmalarını tek portföyde yönetin."
        title="Projeler"
      />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <section className="portfolio-command-bar" aria-label="Portföy özeti">
        <div>
          <span>Toplam dosya</span>
          <strong>{String(portfolioCounts.total).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Aktif çalışma</span>
          <strong>{String(portfolioCounts.active).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Ürün hattı</span>
          <strong>{String(portfolioCounts.product).padStart(2, "0")}</strong>
        </div>
        <p>Her dosya, görev ve finans kayıtlarının ortak referansı olacak.</p>
      </section>

      {loadState === "loading" ? (
        <p className="portfolio-message" role="status">
          Proje portföyü hazırlanıyor…
        </p>
      ) : null}

      {loadState === "error" ? (
        <div className="portfolio-message portfolio-message-error" role="alert">
          <span>Proje portföyüne ulaşılamadı.</span>
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

      {loadState === "ready" && projects.length === 0 && editorMode === null ? (
        <section className="portfolio-empty" aria-labelledby="portfolio-empty-title">
          <span aria-hidden="true">00 / 04</span>
          <div>
            <p className="section-kicker">Başlangıç portföyü</p>
            <h2 id="portfolio-empty-title">Dört ana iş hattını açın</h2>
            <p>
              Mühendis Kafası, ByPusula, OptiPusula ve 7 Emlak Ajansı kayıtları
              tek işlemle oluşturulur. Daha sonra her birini ayrı ayrı düzenleyebilirsiniz.
            </p>
            {initializationError === null ? null : (
              <p className="project-form-error" role="alert">
                {initializationError}
              </p>
            )}
            <button
              className="primary-action"
              disabled={initializing}
              type="button"
              onClick={() => void initializePortfolio()}
            >
              {initializing
                ? "Portföy oluşturuluyor…"
                : initializationError === null
                  ? "Başlangıç portföyünü oluştur"
                  : "Eksik projeleri yeniden dene"}
            </button>
          </div>
        </section>
      ) : null}

      {loadState === "ready" &&
      projects.length > 0 &&
      missingInitialProjects.length > 0 &&
      editorMode === null ? (
        <div
          className={`portfolio-message${
            initializationError === null ? "" : " portfolio-message-error"
          }`}
          role={initializationError === null ? "status" : "alert"}
        >
          <span>
            {initializationError ??
              `Başlangıç portföyünde ${missingInitialProjects.length} proje eksik.`}
          </span>
          <button
            disabled={initializing}
            type="button"
            onClick={() => void initializePortfolio()}
          >
            {initializing
              ? "Eksik projeler oluşturuluyor…"
              : `Eksik ${missingInitialProjects.length} projeyi tamamla`}
          </button>
        </div>
      ) : null}

      {loadState === "ready" && (projects.length > 0 || editorMode !== null) ? (
        <div className="portfolio-layout">
          <aside className="portfolio-index" aria-label="Proje dosyaları">
            <header>
              <span>PORTFÖY / {String(projects.length).padStart(2, "0")}</span>
              <strong>İş hatları</strong>
            </header>
            <ol>
              {projects.map((project, index) => (
                <li key={project.id}>
                  <button
                    aria-current={project.id === selectedProjectId ? "true" : undefined}
                    className={project.id === selectedProjectId ? "is-selected" : undefined}
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setEditorMode(null);
                      setError(null);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <strong>{project.displayName}</strong>
                      <small>{typeLabels[project.projectType]} · {project.shortCode}</small>
                      <small className="project-customer-count">
                        {customerCount(project.id)} müşteri
                      </small>
                    </span>
                    <i className={`portfolio-status-dot status-${project.status}`}>
                      {statusLabels[project.status]}
                    </i>
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <section className="project-dossier">
            {editorMode !== null ? (
              <form className="project-dossier-form" onSubmit={submitProject}>
                <header className="project-dossier-heading">
                  <div>
                    <p className="section-kicker">
                      {editorMode === "create" ? "Yeni proje dosyası" : "Dosya düzenleme"}
                    </p>
                    <h2>{editorMode === "create" ? "Proje tanımla" : "Proje bilgilerini güncelle"}</h2>
                  </div>
                  <span>{editorMode === "edit" ? `v${selectedProject?.version ?? ""}` : "YENİ"}</span>
                </header>
                <div className="project-form-grid">
                  <label className="project-form-name">
                    <span>Proje adı</span>
                    <input
                      maxLength={191}
                      ref={nameInputRef}
                      required
                      value={draft.displayName}
                      onChange={(event) => updateDraft({ displayName: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Kısa kod</span>
                    <input
                      maxLength={32}
                      pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                      required
                      value={draft.shortCode}
                      onChange={(event) => updateDraft({ shortCode: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Proje türü</span>
                    <select
                      value={draft.projectType}
                      onChange={(event) =>
                        updateDraft({ projectType: event.target.value as ProjectType })
                      }
                    >
                      {Object.entries(typeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Durum</span>
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        updateDraft({ status: event.target.value as ProjectStatus })
                      }
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Başlangıç</span>
                    <input
                      max="9999-12-31"
                      min="1000-01-01"
                      type="date"
                      value={draft.startsOn}
                      onChange={(event) => updateDraft({ startsOn: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Hedef bitiş</span>
                    <input
                      max="9999-12-31"
                      min="1000-01-01"
                      type="date"
                      value={draft.targetEndsOn}
                      onChange={(event) => updateDraft({ targetEndsOn: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Planlanan bütçe (₺)</span>
                    <input
                      inputMode="decimal"
                      placeholder="Tanımlanmadı"
                      value={draft.budgetAmount}
                      onChange={(event) => updateDraft({ budgetAmount: event.target.value })}
                    />
                  </label>
                  <label className="project-form-objective">
                    <span>Ana hedef</span>
                    <textarea
                      maxLength={4000}
                      rows={4}
                      value={draft.objective}
                      onChange={(event) => updateDraft({ objective: event.target.value })}
                    />
                  </label>
                  <label className="project-form-note">
                    <span>İç not</span>
                    <textarea
                      maxLength={2000}
                      rows={3}
                      value={draft.internalNote}
                      onChange={(event) => updateDraft({ internalNote: event.target.value })}
                    />
                  </label>
                </div>
                {error === null ? null : (
                  <p className="project-form-error" role="alert">{error}</p>
                )}
                <footer className="project-form-actions">
                  <button className="text-action" disabled={saveState === "saving"} type="button" onClick={closeEditor}>
                    Vazgeç
                  </button>
                  <button className="primary-action" disabled={saveState === "saving"} type="submit">
                    {saveState === "saving" ? "Kaydediliyor…" : "Proje dosyasını kaydet"}
                  </button>
                </footer>
              </form>
            ) : selectedProject === null ? (
              <p className="portfolio-message">Görüntülenecek proje seçin.</p>
            ) : (
              <article className="project-dossier-view" aria-labelledby="project-dossier-title">
                <header className="project-dossier-heading">
                  <div>
                    <p className="section-kicker">{typeLabels[selectedProject.projectType]} / {selectedProject.shortCode}</p>
                    <h2 id="project-dossier-title">{selectedProject.displayName}</h2>
                  </div>
                  <span className={`project-dossier-status status-${selectedProject.status}`}>
                    {statusLabels[selectedProject.status]}
                  </span>
                </header>
                <div className="project-dossier-objective">
                  <span>ANA HEDEF</span>
                  <p>{selectedProject.objective ?? "Bu proje için henüz ana hedef yazılmadı."}</p>
                </div>
                <dl className="project-dossier-facts">
                  <div><dt>Başlangıç</dt><dd>{dateLabel(selectedProject.startsOn)}</dd></div>
                  <div><dt>Hedef bitiş</dt><dd>{dateLabel(selectedProject.targetEndsOn)}</dd></div>
                  <div><dt>Planlanan bütçe</dt><dd>{budgetLabel(selectedProject.budgetAmount)}</dd></div>
                  <div><dt>Kayıt sürümü</dt><dd>v{selectedProject.version}</dd></div>
                </dl>
                <section
                  className="project-customer-sheet"
                  aria-labelledby="project-customer-title"
                >
                  <div>
                    <span>MÜŞTERİLER / {String(selectedProjectCustomers.length).padStart(2, "0")}</span>
                    <h3 id="project-customer-title">Bağlı müşteriler</h3>
                  </div>
                  {selectedProjectCustomers.length > 0 ? (
                    <ul>
                      {selectedProjectCustomers.map((customer) => (
                        <li key={customer.id}>
                          <strong>{customer.displayName}</strong>
                          <small>
                            {customer.shortCode}
                            {customer.status === "inactive" ? " · pasif" : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Bu projeye henüz müşteri bağlanmadı.</p>
                  )}
                  <Link
                    className="project-customer-manage-link"
                    href={`/musteriler?projectId=${encodeURIComponent(selectedProject.id)}`}
                  >
                    Müşterileri görüntüle ve düzenle
                  </Link>
                </section>
                <div className="project-dossier-note">
                  <span>İÇ NOT</span>
                  <p>{selectedProject.internalNote ?? "Not eklenmedi."}</p>
                </div>
                <footer className="project-dossier-actions">
                  <p>Görevler ekranında bu projeyi seçerek işleri aynı dosya altında toplayabilirsiniz.</p>
                  <button className="primary-action" type="button" onClick={openEditEditor}>Projeyi düzenle</button>
                </footer>
              </article>
            )}
          </section>
        </div>
      ) : null}

      {error !== null && editorMode === null ? (
        <p className="portfolio-message portfolio-message-error" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
