"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type FinanceAction = "collection" | "generate" | "opening";
type LoadState = "error" | "loading" | "ready";
type SaveState = "error" | "idle" | "saving" | "success";
type ReceivableStatus = "open" | "overdue" | "paid" | "partial";

type FinanceCustomer = Readonly<{
  id: string;
  name: string;
  projects?: readonly FinanceProject[];
}>;

type FinanceProject = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
}>;

type ContractOption = Readonly<{
  endsOn: string;
  id: string;
  monthlyFeeAmount: string;
  projectId: string | null;
  startsOn: string;
  status: "active" | "closed" | "draft";
}>;

type Receivable = Readonly<{
  collectedAmount: string;
  contractId: string | null;
  createdAtUtc: string;
  customerId: string;
  customerName: string;
  description: string;
  dueOn: string;
  id: string;
  netAmount: string;
  outstandingAmount: string;
  periodMonth: string | null;
  projectId: string | null;
  projectName: string | null;
  projectShortCode: string | null;
  sourceType: "contract_month" | "opening_balance";
  status: ReceivableStatus;
  totalAmount: string;
  vatAmount: string;
}>;

type FinanceSummary = Readonly<{
  collectedThisMonth: string;
  dueThisMonth: string;
  overdue: string;
  outstanding: string;
  totalCollected?: string;
  totalReceivable?: string;
}>;

type ReceivablePayload = Readonly<{
  receivables: readonly Receivable[];
  summary: FinanceSummary;
}>;

type FinanceWorkspaceProps = Readonly<{
  customers: readonly FinanceCustomer[];
  live: boolean;
  projects?: readonly FinanceProject[];
}>;

const emptySummary: FinanceSummary = {
  collectedThisMonth: "0",
  dueThisMonth: "0",
  overdue: "0",
  outstanding: "0",
};

const samplePayload: ReceivablePayload = {
  receivables: [
    {
      collectedAmount: "120000.0000",
      contractId: "sample-contract-1",
      createdAtUtc: "2026-09-01T06:00:00.000Z",
      customerId: "sample-1",
      customerName: "Atlas Makina",
      description: "Eylül 2026 danışmanlık bedeli",
      dueOn: "2026-09-05",
      id: "sample-receivable-1",
      netAmount: "120000.0000",
      outstandingAmount: "0.0000",
      periodMonth: "2026-09",
      projectId: "sample-project-1",
      projectName: "Mühendis Kafası",
      projectShortCode: "MUHENDIS_KAFASI",
      sourceType: "contract_month",
      status: "paid",
      totalAmount: "120000.0000",
      vatAmount: "0.0000",
    },
    {
      collectedAmount: "25000.0000",
      contractId: "sample-contract-2",
      createdAtUtc: "2026-09-01T06:00:00.000Z",
      customerId: "sample-2",
      customerName: "Vega Endüstri",
      description: "Eylül 2026 danışmanlık bedeli",
      dueOn: "2026-09-10",
      id: "sample-receivable-2",
      netAmount: "50000.0000",
      outstandingAmount: "35000.0000",
      periodMonth: "2026-09",
      projectId: "sample-project-1",
      projectName: "Mühendis Kafası",
      projectShortCode: "MUHENDIS_KAFASI",
      sourceType: "contract_month",
      status: "partial",
      totalAmount: "60000.0000",
      vatAmount: "10000.0000",
    },
    {
      collectedAmount: "0.0000",
      contractId: null,
      createdAtUtc: "2026-09-01T06:00:00.000Z",
      customerId: "sample-3",
      customerName: "Kuzey Lojistik",
      description: "Ağustos ayından devreden alacak",
      dueOn: "2026-08-15",
      id: "sample-receivable-3",
      netAmount: "75000.0000",
      outstandingAmount: "75000.0000",
      periodMonth: null,
      projectId: "sample-project-1",
      projectName: "Mühendis Kafası",
      projectShortCode: "MUHENDIS_KAFASI",
      sourceType: "opening_balance",
      status: "overdue",
      totalAmount: "75000.0000",
      vatAmount: "0.0000",
    },
  ],
  summary: {
    collectedThisMonth: "145000.0000",
    dueThisMonth: "35000.0000",
    overdue: "75000.0000",
    outstanding: "110000.0000",
    totalCollected: "145000.0000",
    totalReceivable: "255000.0000",
  },
};

const sampleContractOptions: readonly ContractOption[] = [
  {
    endsOn: "2027-08-31",
    id: "sample-contract",
    monthlyFeeAmount: "50000.0000",
    projectId: "sample-project-1",
    startsOn: "2026-09-01",
    status: "active",
  },
];

function istanbulToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function currentIstanbulMonth(): string {
  return istanbulToday().slice(0, 7);
}

function formatMoney(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    currency: "TRY",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatPeriod(value: string | null): string {
  if (value === null) return "Devir kaydı";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function statusLabel(status: ReceivableStatus): string {
  return {
    open: "Açık",
    overdue: "Gecikmiş",
    paid: "Tahsil edildi",
    partial: "Kısmi tahsilat",
  }[status];
}

function formValue(fields: FormData, name: string): string {
  const value = fields.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function financeWriteErrorMessage(status: string | undefined): string {
  const messages: Readonly<Record<string, string>> = {
    collection_date_in_future: "Tahsilat tarihi bugünden ileri olamaz.",
    collection_exceeds_outstanding: "Tahsilat, alacağın kalan tutarını aşamaz.",
    contract_not_billable: "Seçilen sözleşme bu ay için tahakkuk oluşturmaya uygun değil.",
    contract_project_missing: "Sözleşmenin proje bağlantısı eksik; önce sözleşmeyi güncelleyin.",
    idempotency_conflict: "Aynı işlem anahtarı farklı bilgilerle kullanılmış. Formu kapatıp yeniden açın.",
    month_outside_contract: "Seçilen ay sözleşmenin çalışma dönemi dışında.",
    project_unavailable: "Müşteri seçilen projeye artık aktif olarak bağlı değil.",
    resource_not_found: "Seçilen kayıt artık bulunamıyor. Sayfayı yenileyip tekrar deneyin.",
    validation_error: "Alanları ve tutarları kontrol edin.",
  };
  return messages[status ?? ""] ?? "İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.";
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

async function fetchReceivablePayload(
  projectFilter: string,
  signal?: AbortSignal,
): Promise<ReceivablePayload | null> {
  const query = projectFilter === "all"
    ? ""
    : `?projectId=${encodeURIComponent(projectFilter)}`;
  const response = await fetch(`/api/finance/receivables${query}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 401) {
    redirectToLogin();
    return null;
  }
  if (!response.ok) throw new Error("Receivable list is unavailable.");
  return (await response.json()) as ReceivablePayload;
}

export function FinanceWorkspace({
  customers,
  live,
  projects = [],
}: FinanceWorkspaceProps) {
  const [payload, setPayload] = useState<ReceivablePayload>(() =>
    live ? { receivables: [], summary: emptySummary } : samplePayload,
  );
  const [loadState, setLoadState] = useState<LoadState>(
    live ? "loading" : "ready",
  );
  const [activeAction, setActiveAction] = useState<FinanceAction | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [generateCustomerId, setGenerateCustomerId] = useState("");
  const [openingCustomerId, setOpeningCustomerId] = useState("");
  const [openingProjectId, setOpeningProjectId] = useState("");
  const [contractOptions, setContractOptions] = useState<readonly ContractOption[]>([]);
  const [contractLoadState, setContractLoadState] =
    useState<LoadState>("ready");
  const [projectFilter, setProjectFilter] = useState("all");
  const pendingWrite = useRef<Readonly<{
    fingerprint: string;
    key: string;
  }> | null>(null);

  const financeProjects = useMemo(() => {
    const byId = new Map<string, FinanceProject>();
    for (const project of projects) byId.set(project.id, project);
    for (const customer of customers) {
      for (const project of customer.projects ?? []) byId.set(project.id, project);
    }
    return [...byId.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "tr"),
    );
  }, [customers, projects]);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    void fetchReceivablePayload(projectFilter, controller.signal)
      .then((nextPayload) => {
        if (nextPayload === null) return;
        setPayload({
          receivables: nextPayload.receivables ?? [],
          summary: { ...emptySummary, ...nextPayload.summary },
        });
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });
    return () => controller.abort();
  }, [live, projectFilter]);

  useEffect(() => {
    if (!live || activeAction !== "generate" || generateCustomerId === "") return;

    const controller = new AbortController();
    void fetch(`/api/customers/${generateCustomerId}/contracts`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Contract list is unavailable.");
        return (await response.json()) as { contracts?: ContractOption[] };
      })
      .then((contractPayload) => {
        setContractOptions(contractPayload.contracts ?? []);
        setContractLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setContractOptions([]);
        setContractLoadState("error");
      });
    return () => controller.abort();
  }, [activeAction, generateCustomerId, live]);

  const collectableReceivables = useMemo(
    () => payload.receivables.filter((item) => item.status !== "paid"),
    [payload.receivables],
  );

  const visibleContractOptions = (
    live ? contractOptions : sampleContractOptions
  ).filter((contract) => contract.status === "active");

  const openingProjects = useMemo(() => {
    const customer = customers.find((item) => item.id === openingCustomerId);
    return (customer?.projects ?? []).filter(
      (project) =>
        project.status === "active" ||
        project.status === "planned" ||
        project.status === "on_hold",
    );
  }, [customers, openingCustomerId]);

  const customerProjectName = useCallback(
    (customerId: string, projectId: string | null): string | null => {
      if (projectId === null) return null;
      const customer = customers.find((item) => item.id === customerId);
      const project = customer?.projects?.find((item) => item.id === projectId);
      return project?.displayName ?? null;
    },
    [customers],
  );

  function openAction(action: FinanceAction) {
    setActiveAction((current) => (current === action ? null : action));
    setSaveState("idle");
    setSaveMessage("");
  }

  function selectGenerateCustomer(customerId: string) {
    setGenerateCustomerId(customerId);
    setContractOptions([]);
    setContractLoadState(live && customerId !== "" ? "loading" : "ready");
  }

  function selectOpeningCustomer(customerId: string) {
    const customer = customers.find((item) => item.id === customerId);
    const eligible = (customer?.projects ?? []).filter(
      (project) =>
        project.status === "active" ||
        project.status === "planned" ||
        project.status === "on_hold",
    );
    setOpeningCustomerId(customerId);
    setOpeningProjectId(eligible.length === 1 ? (eligible[0]?.id ?? "") : "");
  }

  async function postFinance(
    endpoint: string,
    body: Record<string, string | null>,
    idempotent = false,
  ): Promise<void> {
    setSaveState("saving");
    setSaveMessage("");
    const fingerprint = `${endpoint}:${JSON.stringify(body)}`;
    if (
      idempotent &&
      (pendingWrite.current === null ||
        pendingWrite.current.fingerprint !== fingerprint)
    ) {
      pendingWrite.current = {
        fingerprint,
        key: globalThis.crypto.randomUUID(),
      };
    }
    const requestBody =
      idempotent && pendingWrite.current !== null
        ? { ...body, clientOperationKey: pendingWrite.current.key }
        : body;
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(requestBody),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          status?: string;
        };
        setSaveState("error");
        setSaveMessage(financeWriteErrorMessage(failure.status));
        return;
      }
      const nextPayload = await fetchReceivablePayload(projectFilter);
      if (nextPayload === null) return;
      setPayload({
        receivables: nextPayload.receivables ?? [],
        summary: { ...emptySummary, ...nextPayload.summary },
      });
      setLoadState("ready");
      if (idempotent) pendingWrite.current = null;
      setSaveState("success");
      setSaveMessage("Kayıt tamamlandı; alacak tablosu güncellendi.");
      setActiveAction(null);
    } catch {
      setSaveState("error");
      setSaveMessage("İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.");
    }
  }

  function submitGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void postFinance("/api/finance/receivables/generate", {
      contractId: formValue(fields, "contractId"),
      month: formValue(fields, "month"),
    });
  }

  function submitOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void postFinance("/api/finance/receivables/opening-balance", {
      customerId: formValue(fields, "customerId"),
      description: formValue(fields, "description"),
      dueOn: formValue(fields, "dueOn"),
      netAmount: formValue(fields, "netAmount"),
      projectId: formValue(fields, "projectId"),
      vatAmount: formValue(fields, "vatAmount"),
    }, true);
  }

  function submitCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const note = formValue(fields, "note");
    void postFinance("/api/finance/collections", {
      amount: formValue(fields, "amount"),
      collectedOn: formValue(fields, "collectedOn"),
      note: note === "" ? null : note,
      receivableId: formValue(fields, "receivableId"),
    }, true);
  }

  const summaryItems: readonly Readonly<{
    key: string;
    label: string;
    tone?: "attention" | "positive";
    value: string;
  }>[] = [
    { key: "outstanding", label: "Toplam açık", value: payload.summary.outstanding },
    { key: "overdue", label: "Geciken", tone: "attention", value: payload.summary.overdue },
    { key: "dueThisMonth", label: "Bu ay beklenen", value: payload.summary.dueThisMonth },
    {
      key: "collectedThisMonth",
      label: "Bu ay tahsil edilen",
      tone: "positive",
      value: payload.summary.collectedThisMonth,
    },
  ];

  return (
    <section className="finance-workspace" id="finans" aria-labelledby="finance-title">
      <header className="finance-heading">
        <div>
          <p className="section-kicker">Finans / Alacak takibi</p>
          <h2 id="finance-title">Alacak ve tahsilat</h2>
          <p>Aylık hakedişleri, geçmiş alacakları ve gelen ödemeleri aynı kayıt üzerinden yönetin.</p>
        </div>
        <div className="finance-actions" aria-label="Finans işlemleri">
          <button
            aria-expanded={activeAction === "generate"}
            className="primary-action"
            type="button"
            onClick={() => openAction("generate")}
          >
            Ayı oluştur
          </button>
          <button
            aria-expanded={activeAction === "opening"}
            className="text-action"
            type="button"
            onClick={() => openAction("opening")}
          >
            Geçmiş alacak ekle
          </button>
          <button
            aria-expanded={activeAction === "collection"}
            className="text-action"
            disabled={collectableReceivables.length === 0}
            type="button"
            onClick={() => openAction("collection")}
          >
            Tahsilat gir
          </button>
        </div>
      </header>

      <section className="finance-summary" aria-label="Alacak özeti">
        {summaryItems.map((item) => (
          <div className={item.tone ? `is-${item.tone}` : undefined} key={item.key}>
            <span>{item.label}</span>
            <strong>{loadState === "loading" ? "—" : formatMoney(item.value)}</strong>
          </div>
        ))}
      </section>

      {activeAction !== null ? (
        <section className="finance-entry" aria-labelledby={`finance-${activeAction}-title`}>
          <div className="finance-entry-intro">
            <p className="section-kicker">Yeni finans kaydı</p>
            <h3 id={`finance-${activeAction}-title`}>
              {activeAction === "generate"
                ? "Sözleşmeden aylık alacak oluştur"
                : activeAction === "opening"
                  ? "Geçmiş alacak ekle"
                  : "Tahsilat gir"}
            </h3>
            <p>
              {activeAction === "generate"
                ? "Seçilen sözleşme ve dönem için hakedişi bir kez üretir."
                : activeAction === "opening"
                  ? "Sisteme başlamadan önce doğmuş açık bakiyeyi kaydeder."
                  : "Ödemenin tamamını veya bir bölümünü açık alacağa işler."}
            </p>
          </div>

          {activeAction === "generate" ? (
            <form className="finance-form" onSubmit={submitGenerate}>
              <label>
                <span>Müşteri</span>
                <select
                  aria-label="Ay oluşturulacak müşteri"
                  required
                  value={generateCustomerId}
                  onChange={(event) => selectGenerateCustomer(event.target.value)}
                >
                  <option value="">Müşteri seçin</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sözleşme</span>
                <select
                  aria-label="Aylık alacak sözleşmesi"
                  disabled={contractLoadState !== "ready" || visibleContractOptions.length === 0}
                  name="contractId"
                  required
                >
                  <option value="">
                    {contractLoadState === "loading"
                      ? "Sözleşmeler yükleniyor…"
                      : visibleContractOptions.length === 0
                        ? "Aktif sözleşme bulunamadı"
                        : "Sözleşme seçin"}
                  </option>
                  {visibleContractOptions.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {customerProjectName(generateCustomerId, contract.projectId) ?? "Proje atanmamış"} · {formatMoney(contract.monthlyFeeAmount)} · {formatDate(contract.startsOn)}–{formatDate(contract.endsOn)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Dönem</span>
                <input defaultValue={currentIstanbulMonth()} name="month" required type="month" />
              </label>
              {contractLoadState === "error" ? (
                <p className="entry-error" role="alert">Sözleşmeler yüklenemedi.</p>
              ) : null}
              <div className="finance-form-actions">
                <button className="text-action" type="button" onClick={() => setActiveAction(null)}>
                  Vazgeç
                </button>
                <button
                  className="primary-action"
                  disabled={!live || saveState === "saving" || visibleContractOptions.length === 0}
                  type="submit"
                >
                  {!live ? "Önizleme" : saveState === "saving" ? "Oluşturuluyor…" : "Alacağı oluştur"}
                </button>
              </div>
            </form>
          ) : null}

          {activeAction === "opening" ? (
            <form className="finance-form" onSubmit={submitOpening}>
              <label>
                <span>Müşteri</span>
                <select
                  name="customerId"
                  required
                  value={openingCustomerId}
                  onChange={(event) => selectOpeningCustomer(event.target.value)}
                >
                  <option value="">Müşteri seçin</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Proje</span>
                <select
                  aria-label="Geçmiş alacak projesi"
                  disabled={openingCustomerId === "" || openingProjects.length === 0}
                  name="projectId"
                  required
                  value={openingProjectId}
                  onChange={(event) => setOpeningProjectId(event.target.value)}
                >
                  <option value="">
                    {openingCustomerId === ""
                      ? "Önce müşteri seçin"
                      : openingProjects.length === 0
                        ? "Müşteriye bağlı proje yok"
                        : "Proje seçin"}
                  </option>
                  {openingProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.displayName} · {project.shortCode}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Vade tarihi</span>
                <input defaultValue={istanbulToday()} name="dueOn" required type="date" />
              </label>
              <label className="finance-form-wide">
                <span>Açıklama</span>
                <input
                  defaultValue="Geçmiş dönem danışmanlık alacağı"
                  maxLength={191}
                  name="description"
                  required
                />
              </label>
              <label>
                <span>Net tutar</span>
                <input inputMode="decimal" min="0.01" name="netAmount" required step="0.01" type="number" />
              </label>
              <label>
                <span>KDV tutarı</span>
                <input defaultValue="0" inputMode="decimal" min="0" name="vatAmount" required step="0.01" type="number" />
              </label>
              <div className="finance-form-actions">
                <button className="text-action" type="button" onClick={() => setActiveAction(null)}>
                  Vazgeç
                </button>
                <button className="primary-action" disabled={!live || saveState === "saving"} type="submit">
                  {!live ? "Önizleme" : saveState === "saving" ? "Kaydediliyor…" : "Geçmiş alacağı kaydet"}
                </button>
              </div>
            </form>
          ) : null}

          {activeAction === "collection" ? (
            <form className="finance-form" onSubmit={submitCollection}>
              <label className="finance-form-wide">
                <span>Alacak kaydı</span>
                <select name="receivableId" required>
                  <option value="">Alacak seçin</option>
                  {collectableReceivables.map((receivable) => (
                    <option key={receivable.id} value={receivable.id}>
                      {receivable.customerName} · {receivable.projectName ?? "Proje atanmamış"} · {formatPeriod(receivable.periodMonth)} · kalan {formatMoney(receivable.outstandingAmount)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tahsil edilen tutar</span>
                <input inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" />
              </label>
              <label>
                <span>Tahsilat tarihi</span>
                <input
                  defaultValue={istanbulToday()}
                  max={istanbulToday()}
                  name="collectedOn"
                  required
                  type="date"
                />
              </label>
              <label className="finance-form-wide">
                <span>Not</span>
                <input maxLength={500} name="note" placeholder="İsteğe bağlı" />
              </label>
              <div className="finance-form-actions">
                <button className="text-action" type="button" onClick={() => setActiveAction(null)}>
                  Vazgeç
                </button>
                <button className="primary-action" disabled={!live || saveState === "saving"} type="submit">
                  {!live ? "Önizleme" : saveState === "saving" ? "İşleniyor…" : "Tahsilatı işle"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {saveMessage !== "" ? (
        <p className={saveState === "error" ? "entry-error finance-feedback" : "finance-feedback is-success"} role={saveState === "error" ? "alert" : "status"}>
          {saveMessage}
        </p>
      ) : null}

      {loadState === "error" ? (
        <p className="entry-error finance-feedback" role="alert">
          Alacak kayıtlarına ulaşılamadı. Bağlantıyı kontrol edip sayfayı yenileyin.
        </p>
      ) : null}

      {financeProjects.length > 0 ? (
        <div className="finance-receivable-toolbar">
          <label>
            <span>Tablodaki proje</span>
            <select
              aria-label="Alacak proje filtresi"
              value={projectFilter}
              onChange={(event) => {
                setLoadState("loading");
                setProjectFilter(event.target.value);
              }}
            >
              <option value="all">Tüm projeler</option>
              {financeProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName} · {project.shortCode}
                </option>
              ))}
            </select>
          </label>
          <span>Özet ve kayıtlar seçilen projeye göre birlikte güncellenir.</span>
        </div>
      ) : null}

      <div className="finance-table-wrap">
        <table className="finance-table" aria-label="Alacak ve tahsilat kayıtları">
          <thead>
            <tr>
              <th scope="col">Müşteri</th>
              <th scope="col">Proje</th>
              <th scope="col">Dönem</th>
              <th scope="col">Vade</th>
              <th scope="col">Toplam</th>
              <th scope="col">Tahsil</th>
              <th scope="col">Kalan</th>
              <th scope="col">Durum</th>
            </tr>
          </thead>
          <tbody>
            {payload.receivables.map((receivable) => (
              <tr key={receivable.id}>
                <td data-label="Müşteri">
                  <strong>{receivable.customerName}</strong>
                  <small>{receivable.description}</small>
                </td>
                <td data-label="Proje">
                  <strong>{receivable.projectName ?? "Proje atanmamış"}</strong>
                  {receivable.projectShortCode === null ? null : (
                    <small>{receivable.projectShortCode}</small>
                  )}
                </td>
                <td data-label="Dönem">{formatPeriod(receivable.periodMonth)}</td>
                <td data-label="Vade">{formatDate(receivable.dueOn)}</td>
                <td data-label="Toplam">{formatMoney(receivable.totalAmount)}</td>
                <td data-label="Tahsil">{formatMoney(receivable.collectedAmount)}</td>
                <td data-label="Kalan">{formatMoney(receivable.outstandingAmount)}</td>
                <td data-label="Durum">
                  <span className={`finance-status finance-status-${receivable.status}`}>
                    {statusLabel(receivable.status)}
                  </span>
                </td>
              </tr>
            ))}
            {payload.receivables.length === 0 ? (
              <tr>
                <td className="empty-row" colSpan={8}>
                  {loadState === "loading"
                    ? "Alacak kayıtları yükleniyor…"
                    : "Henüz alacak kaydı yok. Ayı oluşturarak veya geçmiş alacak ekleyerek başlayın."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
