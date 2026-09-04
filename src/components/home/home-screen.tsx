"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { CustomerWorkspace } from "@/components/home/customer-workspace";
import { PortalPageHeader } from "@/components/portal/portal-page-header";

type CustomerView = Readonly<{
  archiveReason?: string | null;
  archivedAtUtc?: string | null;
  code: string;
  contact: string;
  contactNote?: string | null;
  email?: string | null;
  fee: string;
  id: string;
  name: string;
  payment: string;
  phone?: string | null;
  projects: readonly ProjectSummary[];
  status: string;
  tone: "active" | "inactive" | "late" | "paid" | "waiting";
  visit: string;
  version?: number;
}>;

type ProjectStatus =
  | "planned"
  | "active"
  | "on_hold"
  | "completed"
  | "cancelled";

type ProjectSummary = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: ProjectStatus;
}>;

type StoredCustomer = Readonly<{
  archiveReason?: string | null;
  archivedAtUtc?: string | null;
  contactNote: string | null;
  displayName: string;
  email: string | null;
  id: string;
  overview: Readonly<{
    billing?: Readonly<{
      activeContractCount: number;
      currency: "TRY";
      monthlyFeeAmount: string;
      paymentDays: readonly number[];
      vatMode: "exempt" | "exclusive" | "inclusive" | "mixed";
    }>;
    nextVisitOn: string | null;
  }>;
  phone: string | null;
  projects: readonly ProjectSummary[];
  shortCode: string;
  status: "active" | "inactive";
  version?: number;
}>;

function canAcceptNewCustomerLink(status: ProjectStatus): boolean {
  return status === "active" || status === "planned" || status === "on_hold";
}

function customerProjectStatusSuffix(status: ProjectStatus): string {
  if (status === "active") return "";
  if (status === "planned") return " · planlandı";
  return " · beklemede";
}

const sampleProject: ProjectSummary = {
  displayName: "Mühendis Kafası",
  id: "sample-project-1",
  shortCode: "MUHENDIS_KAFASI",
  status: "active",
};

const sampleCustomers: readonly CustomerView[] = [
  {
    code: "MK-001",
    contact: "İletişim kaydı bekliyor",
    name: "Atlas Makina",
    id: "sample-1",
    visit: "3 Eylül",
    fee: "120.000 ₺",
    payment: "İzleyen ayın 5. günü",
    projects: [sampleProject],
    status: "Tahsil edildi",
    tone: "paid",
  },
  {
    code: "MK-002",
    contact: "İletişim kaydı bekliyor",
    name: "Vega Endüstri",
    id: "sample-2",
    visit: "10 Eylül",
    fee: "50.000 ₺ + KDV",
    payment: "İzleyen ayın 10. günü",
    projects: [sampleProject],
    status: "Gecikti",
    tone: "late",
  },
  {
    code: "MK-003",
    contact: "İletişim kaydı bekliyor",
    name: "Kuzey Lojistik",
    id: "sample-3",
    visit: "Planlanmadı",
    fee: "75.000 ₺",
    payment: "İzleyen ayın 15. günü",
    projects: [sampleProject],
    status: "Bekliyor",
    tone: "waiting",
  },
  {
    code: "MK-004",
    contact: "İletişim kaydı bekliyor",
    name: "Delta Üretim",
    id: "sample-4",
    visit: "17 Eylül",
    fee: "50.000 ₺ + KDV",
    payment: "İzleyen ayın 20. günü",
    projects: [sampleProject],
    status: "Bekliyor",
    tone: "waiting",
  },
  {
    code: "MK-005",
    contact: "İletişim kaydı bekliyor",
    name: "Rota Teknoloji",
    id: "sample-5",
    visit: "Planlanmadı",
    fee: "50.000 ₺",
    payment: "İzleyen ayın 25. günü",
    projects: [sampleProject],
    status: "Gecikti",
    tone: "late",
  },
] as const;

function generatedCustomerCode(displayName: FormDataEntryValue | null): string {
  const rawName = typeof displayName === "string" ? displayName : "";
  const base = rawName
    .replace(/[ıİ]/gu, "I")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 24) || "MUSTERI";
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 4).toUpperCase();
  return `${base}_${suffix}`;
}

function storedCustomerView(
  customer: StoredCustomer,
  capabilities: NonNullable<HomeScreenProps["capabilities"]> = fullCapabilities,
): CustomerView {
  const billing = customer.overview.billing;
  return {
    archiveReason: customer.archiveReason ?? null,
    archivedAtUtc: customer.archivedAtUtc ?? null,
    code: customer.shortCode,
    contact: customer.email ?? customer.phone ?? "İletişim bilgisi yok",
    contactNote: customer.contactNote,
    email: customer.email,
    fee:
      capabilities.canReadBilling && billing
        ? contractFeeLabel(billing)
        : "Erişim kısıtlı",
    id: customer.id,
    name: customer.displayName,
    payment: capabilities.canReadBilling && billing
      ? billing.paymentDays.length === 1
        ? `İzleyen ayın ${billing.paymentDays[0]}. günü`
        : `İzleyen ayın ${billing.paymentDays.join(", ")}. günleri`
      : "Erişim kısıtlı",
    phone: customer.phone,
    projects: customer.projects,
    status: customer.status === "active" ? "Aktif" : "Pasif",
    tone: customer.status,
    visit: !capabilities.canReadVisits
      ? "Erişim kısıtlı"
      : customer.overview.nextVisitOn
        ? shortVisitDate(customer.overview.nextVisitOn)
        : "Planlanmadı",
    version: customer.version,
  };
}

function contractFeeLabel(contract: {
  monthlyFeeAmount: string;
  vatMode: "exempt" | "exclusive" | "inclusive" | "mixed";
}): string {
  const amount = new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2,
  }).format(Number(contract.monthlyFeeAmount));
  if (contract.vatMode === "exclusive") return `${amount} ₺ + KDV`;
  if (contract.vatMode === "inclusive") return `${amount} ₺ (KDV dahil)`;
  if (contract.vatMode === "mixed") return `${amount} ₺ (karma KDV)`;
  return `${amount} ₺`;
}

function shortVisitDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

type HomeScreenProps = Readonly<{
  capabilities?: Readonly<{
    canOpenCustomerDetails: boolean;
    canReadBilling: boolean;
    canReadProjects: boolean;
    canReadVisits: boolean;
    canReadAudit: boolean;
    canLifecycleContracts: boolean;
    canLifecycleCustomers: boolean;
    canWriteCustomers: boolean;
  }>;
  live?: boolean;
}>;

const fullCapabilities: NonNullable<HomeScreenProps["capabilities"]> = {
  canOpenCustomerDetails: true,
  canReadBilling: true,
  canReadProjects: true,
  canReadVisits: true,
  canReadAudit: true,
  canLifecycleContracts: true,
  canLifecycleCustomers: true,
  canWriteCustomers: true,
};

export function HomeScreen({
  capabilities = fullCapabilities,
  live = false,
}: HomeScreenProps) {
  const [customerRows, setCustomerRows] =
    useState<readonly CustomerView[]>(() => (live ? [] : sampleCustomers));
  const [projects, setProjects] = useState<readonly ProjectSummary[]>(() =>
    live ? [] : [sampleProject],
  );
  const [dataState, setDataState] = useState<
    "error" | "live" | "loading" | "sample"
  >(live ? "loading" : "sample");
  const [filter, setFilter] = useState<"all" | "late">("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"error" | "idle" | "saving">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newCustomerProjectIds, setNewCustomerProjectIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();

    void Promise.all([
      fetch("/api/customers", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }),
      capabilities.canReadProjects
        ? fetch("/api/projects", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          })
        : Promise.resolve(null),
    ])
      .then(async ([customersResponse, projectsResponse]) => {
        if (!customersResponse.ok || (projectsResponse && !projectsResponse.ok)) {
          throw new Error("Customer workspace is unavailable.");
        }
        const customerPayload = (await customersResponse.json()) as {
          customers?: StoredCustomer[];
        };
        const projectPayload = projectsResponse
          ? ((await projectsResponse.json()) as { projects?: ProjectSummary[] })
          : null;
        if (
          !Array.isArray(customerPayload.customers) ||
          (projectPayload !== null && !Array.isArray(projectPayload.projects))
        ) {
          throw new Error("Customer workspace response is invalid.");
        }
        const projectedProjects = new Map<string, ProjectSummary>();
        for (const customer of customerPayload.customers) {
          for (const project of customer.projects) projectedProjects.set(project.id, project);
        }
        return {
          customers: customerPayload.customers.map((customer) =>
            storedCustomerView(customer, capabilities),
          ),
          projects: projectPayload?.projects ?? [...projectedProjects.values()],
        };
      })
      .then((payload) => {
        setCustomerRows(payload.customers);
        setProjects(payload.projects);
        const requestedProjectId = new URLSearchParams(window.location.search).get(
          "projectId",
        );
        if (
          requestedProjectId !== null &&
          (requestedProjectId === "unassigned" ||
            payload.projects.some((project) => project.id === requestedProjectId))
        ) {
          setProjectFilter(requestedProjectId);
        }
        setDataState("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataState("error");
      });

    return () => controller.abort();
  }, [capabilities, live]);

  const visibleCustomers = useMemo(() => {
    const canonicalQuery = query.trim().toLocaleLowerCase("tr-TR");
    return customerRows.filter((customer) => {
      const queryMatches =
        canonicalQuery.length === 0 ||
        customer.name.toLocaleLowerCase("tr-TR").includes(canonicalQuery) ||
        customer.code.toLocaleLowerCase("tr-TR").includes(canonicalQuery) ||
        customer.projects.some(
          (project) =>
            project.displayName
              .toLocaleLowerCase("tr-TR")
              .includes(canonicalQuery) ||
            project.shortCode
              .toLocaleLowerCase("tr-TR")
              .includes(canonicalQuery),
        );
      const filterMatches = filter === "all" || customer.tone === "late";
      const projectMatches =
        projectFilter === "all" ||
        (projectFilter === "unassigned"
          ? customer.projects.length === 0
          : customer.projects.some((project) => project.id === projectFilter));
      return queryMatches && filterMatches && projectMatches;
    });
  }, [customerRows, filter, projectFilter, query]);

  const selectedCustomer = useMemo(
    () => customerRows.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customerRows, selectedCustomerId],
  );

  const handleContractSaved = useCallback(
    (contract: {
      customerId: string;
      monthlyFeeAmount: string;
      paymentDay: number;
      vatMode: "exempt" | "exclusive" | "inclusive";
    }) => {
      setCustomerRows((current) =>
        current.map((customer) =>
          customer.id === contract.customerId
            ? {
                ...customer,
                fee: contractFeeLabel(contract),
                payment: `İzleyen ayın ${contract.paymentDay}. günü`,
              }
            : customer,
        ),
      );
    },
    [],
  );

  const handleCustomerSaved = useCallback(
    (customer: {
      contactNote: string | null;
      displayName: string;
      email: string | null;
      id: string;
      phone: string | null;
      projects: readonly ProjectSummary[];
      archiveReason?: string | null;
      archivedAtUtc?: string | null;
      status?: "active" | "inactive";
      version?: number;
    }) => {
      setCustomerRows((current) =>
        current.map((row) =>
          row.id === customer.id
            ? {
                ...row,
                contact: customer.email ?? customer.phone ?? "İletişim bilgisi yok",
                contactNote: customer.contactNote,
                email: customer.email,
                name: customer.displayName,
                phone: customer.phone,
                projects: customer.projects,
                archiveReason: customer.archiveReason === undefined
                  ? row.archiveReason
                  : customer.archiveReason,
                archivedAtUtc: customer.archivedAtUtc === undefined
                  ? row.archivedAtUtc
                  : customer.archivedAtUtc,
                status: customer.status === undefined
                  ? row.status
                  : customer.status === "active"
                    ? "Aktif"
                    : "Pasif",
                tone: customer.status ?? row.tone,
                version: customer.version ?? row.version,
              }
            : row,
        ),
      );
    },
    [],
  );

  const handleVisitsSaved = useCallback(
    (
      visits: readonly {
        committedOn: string;
        resolutionStatus:
          | "planned"
          | "completed"
          | "makeup_pending"
          | "cancelled_by_agreement";
      }[],
    ) => {
      if (selectedCustomerId === null) return;
      const nextVisit = [...visits]
        .filter(
          (visit) =>
            visit.resolutionStatus === "planned" ||
            visit.resolutionStatus === "makeup_pending",
        )
        .sort((left, right) =>
          left.committedOn.localeCompare(right.committedOn),
        )[0];
      setCustomerRows((current) =>
        current.map((customer) =>
          customer.id === selectedCustomerId
            ? {
                ...customer,
                visit: nextVisit
                  ? shortVisitDate(nextVisit.committedOn)
                  : "Planlanmadı",
              }
            : customer,
        ),
      );
    },
    [selectedCustomerId],
  );

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const projectIds = newCustomerProjectIds;
    if (projectIds.length === 0) {
      setSaveState("error");
      setSaveError("Müşteriyi en az bir projeye bağlayın.");
      return;
    }
    setSaveState("saving");
    setSaveError(null);

    try {
      const response = await fetch("/api/customers", {
        body: JSON.stringify({
          contactNote: fields.get("contactNote"),
          displayName: fields.get("displayName"),
          email: fields.get("email"),
          phone: fields.get("phone"),
          projectIds,
          shortCode: generatedCustomerCode(fields.get("displayName")),
          status: "active",
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Customer could not be saved.");
      const payload = (await response.json()) as { customer: StoredCustomer };
      setCustomerRows((current) => [
        ...current,
        storedCustomerView(payload.customer),
      ]);
      setSelectedCustomerId(payload.customer.id);
      setDataState("live");
      setSaveState("idle");
      setSaveError(null);
      setNewCustomerProjectIds([]);
      setFormOpen(false);
      form.reset();
    } catch {
      setSaveState("error");
      setSaveError("Kayıt tamamlanamadı. Bağlantıyı ve alanları kontrol edip yeniden deneyin.");
    }
  }

  const dataMessage =
    dataState === "live"
      ? "Kayıtlar veritabanından okunuyor. Bir müşteri seçerek sözleşme ve aylık ziyaret planını açın."
      : dataState === "loading"
        ? "Müşteri kayıtları yükleniyor…"
        : dataState === "error"
          ? "Müşteri kayıtlarına ulaşılamadı. Bağlantıyı kontrol edip sayfayı yenileyin."
          : "Aşağıdaki kayıtlar arayüzü değerlendirmek için hazırlanmış örnek verilerdir.";

  return (
    <div className="customer-page-workspace">
      <PortalPageHeader
        actions={capabilities.canWriteCustomers ? (
          <button
            className="primary-action"
            type="button"
            aria-label="Müşteri ekle"
            aria-expanded={formOpen}
            onClick={() => {
              setFormOpen((current) => !current);
              setSaveState("idle");
              setSaveError(null);
            }}
          >
            + Müşteri ekle
          </button>
        ) : undefined}
        context="Müşteri masası"
        note="Sözleşme, ziyaret ve tahsilat durumuna tek bakış."
        title="Müşteriler"
      />

          {formOpen && capabilities.canWriteCustomers ? (
            <section className="customer-entry" aria-labelledby="customer-entry-title">
              <div>
                <p className="section-kicker">Yeni kayıt</p>
                <h2 id="customer-entry-title">Müşteri ekle</h2>
                <p>Sözleşme ve ziyaret planı, müşteri kaydedildikten sonra eklenecek.</p>
              </div>
              <form onSubmit={submitCustomer}>
                <label>
                  <span>Müşteri / şirket adı</span>
                  <input maxLength={191} name="displayName" required />
                </label>
                <label>
                  <span>E-posta</span>
                  <input autoComplete="email" maxLength={254} name="email" type="email" />
                </label>
                <label>
                  <span>Telefon</span>
                  <input autoComplete="tel" maxLength={32} name="phone" type="tel" />
                </label>
                <label className="entry-note">
                  <span>İletişim notu</span>
                  <textarea maxLength={2000} name="contactNote" rows={2} />
                </label>
                <fieldset className="customer-project-picker">
                  <legend>Bağlı projeler</legend>
                  <p>Müşterinin hizmet aldığı bir veya daha fazla iş hattını seçin.</p>
                  <div className="customer-project-options">
                    {projects
                      .filter((project) =>
                        canAcceptNewCustomerLink(project.status),
                      )
                      .map((project) => (
                        <label key={project.id}>
                          <input
                            checked={newCustomerProjectIds.includes(project.id)}
                            name="projectIds"
                            type="checkbox"
                            value={project.id}
                            onChange={(event) =>
                              setNewCustomerProjectIds((current) =>
                                event.target.checked
                                  ? [...current, project.id]
                                  : current.filter((id) => id !== project.id),
                              )
                            }
                          />
                          <span>
                            <strong>{project.displayName}</strong>
                            <small>
                              {project.shortCode}
                              {customerProjectStatusSuffix(project.status)}
                            </small>
                          </span>
                        </label>
                      ))}
                    {projects.every(
                      (project) => !canAcceptNewCustomerLink(project.status),
                    ) ? (
                      <p className="customer-project-empty">
                        Müşteri bağlanabilecek proje bulunmuyor.
                      </p>
                    ) : null}
                  </div>
                </fieldset>
                <div className="entry-actions">
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => {
                      setFormOpen(false);
                      setNewCustomerProjectIds([]);
                      setSaveError(null);
                    }}
                  >
                    Vazgeç
                  </button>
                  <button
                    className="primary-action"
                    disabled={
                      saveState === "saving" ||
                      projects.every(
                        (project) => !canAcceptNewCustomerLink(project.status),
                      )
                    }
                    type="submit"
                  >
                    {saveState === "saving" ? "Kaydediliyor…" : "Müşteriyi kaydet"}
                  </button>
                </div>
                {saveState === "error" && saveError !== null ? (
                  <p className="entry-error" role="alert">
                    {saveError}
                  </p>
                ) : null}
              </form>
            </section>
          ) : null}

          <p className="sample-note" role="note">
            {dataMessage}
          </p>

          <section className="ledger-summary" aria-label="Müşteri özeti">
            <div>
              <span>Aktif müşteri</span>
              <strong>{String(customerRows.filter((item) => item.tone !== "inactive").length).padStart(2, "0")}</strong>
            </div>
            <div>
              <span>Bugünkü ziyaret</span>
              <strong>{live ? "—" : "02"}</strong>
            </div>
            <div>
              <span>Geciken ödeme</span>
              <strong className="attention-ink">
                {live
                  ? "—"
                  : String(customerRows.filter((item) => item.tone === "late").length).padStart(2, "0")}
              </strong>
            </div>
            <div>
              <span>Açık hakediş</span>
              <strong>{live ? "—" : "225.000 ₺"}</strong>
            </div>
          </section>

          <div className="workbench-grid">
            <section
              className="customer-ledger"
              id="musteriler"
              aria-labelledby="customer-ledger-title"
            >
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Kayıt / {String(customerRows.length).padStart(2, "0")}</p>
                  <h2 id="customer-ledger-title">Müşteri kayıtları</h2>
                </div>
                <div className="ledger-tools" aria-label="Müşteri araçları">
                  <label className="search-field">
                    <span className="sr-only">Müşteri ara</span>
                    <input
                      type="search"
                      placeholder="Müşteri ara"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <label className="customer-project-filter">
                    <span className="sr-only">Projeye göre filtrele</span>
                    <select
                      aria-label="Projeye göre filtrele"
                      value={projectFilter}
                      onChange={(event) => setProjectFilter(event.target.value)}
                    >
                      <option value="all">Tüm projeler</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.displayName}
                        </option>
                      ))}
                      <option value="unassigned">Proje atanmamış</option>
                    </select>
                  </label>
                  <div className="filter-set" aria-label="Kayıt filtresi">
                    <button
                      className={filter === "all" ? "is-selected" : undefined}
                      type="button"
                      onClick={() => setFilter("all")}
                    >
                      Tümü
                    </button>
                    <button
                      className={filter === "late" ? "is-selected" : undefined}
                      type="button"
                      onClick={() => setFilter("late")}
                    >
                      Geciken
                    </button>
                  </div>
                </div>
              </div>

              <div className="customer-table-wrap">
                <table className="customer-table" aria-label="Müşteri kayıtları">
                  <thead>
                    <tr>
                      <th scope="col">Müşteri</th>
                      <th scope="col">Projeler</th>
                      <th scope="col">Sonraki ziyaret</th>
                      <th scope="col">Aylık ücret</th>
                      <th scope="col">Ödeme</th>
                      <th scope="col">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCustomers.map((customer) => (
                      <tr key={customer.id}>
                        <td data-label="Müşteri">
                          <button
                            aria-expanded={selectedCustomerId === customer.id}
                            className="customer-link"
                            type="button"
                            onClick={() =>
                              setSelectedCustomerId((current) =>
                                current === customer.id ? null : customer.id,
                              )
                            }
                          >
                            <strong>{customer.name}</strong>
                            <small>{customer.code}</small>
                          </button>
                        </td>
                        <td className="customer-project-cell" data-label="Projeler">
                          {customer.projects.length > 0 ? (
                            <span className="customer-project-badges">
                              {customer.projects.map((project) => (
                                <span className="customer-project-badge" key={project.id}>
                                  {project.displayName}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="customer-project-unassigned">
                              Proje atanmamış
                            </span>
                          )}
                        </td>
                        <td data-label="Sonraki ziyaret">{customer.visit}</td>
                        <td data-label="Aylık ücret">{customer.fee}</td>
                        <td data-label="Ödeme">{customer.payment}</td>
                        <td data-label="Durum">
                          <span className={`record-status record-status-${customer.tone}`}>
                            {customer.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {visibleCustomers.length === 0 ? (
                      <tr>
                        <td className="empty-row" colSpan={6}>
                          {customerRows.length === 0
                            ? "Henüz müşteri kaydı yok. İlk müşteriyi ekleyerek başlayın."
                            : "Arama veya filtreyle eşleşen kayıt bulunamadı."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

          </div>

          {selectedCustomer && capabilities.canOpenCustomerDetails ? (
            <CustomerWorkspace
              key={selectedCustomer.id}
              customer={{
                contactNote: selectedCustomer.contactNote ?? null,
                archiveReason: selectedCustomer.archiveReason ?? null,
                archivedAtUtc: selectedCustomer.archivedAtUtc ?? null,
                displayName: selectedCustomer.name,
                email: selectedCustomer.email ?? null,
                id: selectedCustomer.id,
                name: selectedCustomer.name,
                phone: selectedCustomer.phone ?? null,
                projects: selectedCustomer.projects,
                status: selectedCustomer.tone === "inactive" ? "inactive" : "active",
                version: selectedCustomer.version,
              }}
              availableProjects={projects}
              capabilities={{
                canLifecycleContracts: capabilities.canLifecycleContracts,
                canLifecycleCustomers: capabilities.canLifecycleCustomers,
                canReadAudit: capabilities.canReadAudit,
              }}
              live={live}
              onContractSaved={handleContractSaved}
              onCustomerSaved={handleCustomerSaved}
              onVisitsSaved={handleVisitsSaved}
            />
          ) : selectedCustomer ? (
            <p className="workspace-selector-note" role="note">
              Bu müşteri için iletişim, sözleşme ve ziyaret ayrıntıları hesabınıza
              verilen modül izinleriyle sınırlandırılmıştır.
            </p>
          ) : (
            <p className="workspace-selector-note">
              Sözleşme ve ziyaret planını açmak için müşteri adını seçin.
            </p>
          )}

    </div>
  );
}
