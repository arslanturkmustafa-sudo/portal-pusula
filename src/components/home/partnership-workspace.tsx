"use client";

import Decimal from "decimal.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import styles from "./partnership-workspace.module.css";

type ProjectDto = Readonly<{
  displayName: string;
  id: string;
  projectType: "consulting" | "internal" | "partnership" | "product";
  shortCode: string;
  status: "active" | "cancelled" | "completed" | "on_hold" | "planned";
}>;
type CommissionMode = "partner_only" | "user_one_side" | "user_both";
type CommissionStatus = "agency_collected" | "cancelled" | "expected" | "paid";
type CommissionDto = Readonly<{
  agencyCollectedOn: string | null;
  closedOn: string;
  commissionBasisAmount: string;
  contributionMode: CommissionMode;
  description: string;
  id: string;
  note: string | null;
  paidOn: string | null;
  projectId: string;
  projectName: string;
  projectShortCode: string;
  shareAmount: string;
  shareRate: string;
  status: CommissionStatus;
  transactionType: "rental" | "sale";
  version: number;
}>;
type ContributionStatus = "cancelled" | "expected" | "partial" | "received";
type ContributionReceiptDto = Readonly<{
  amount: string;
  contributionId: string;
  id: string;
  note: string | null;
  receivedOn: string;
}>;
type ContributionDto = Readonly<{
  contributionMonth: string;
  description: string;
  dueOn: string;
  expectedAmount: string;
  id: string;
  note: string | null;
  projectId: string;
  projectName: string;
  projectShortCode: string;
  receivedAmount: string;
  receivedOn: string | null;
  receipts: readonly ContributionReceiptDto[];
  status: ContributionStatus;
  version: number;
}>;
type CommissionDraft = {
  agencyCollectedOn: string;
  closedOn: string;
  commissionBasisAmount: string;
  contributionMode: CommissionMode;
  description: string;
  note: string;
  paidOn: string;
  projectId: string;
  status: CommissionStatus;
  transactionType: "rental" | "sale";
};
type ContributionDraft = {
  contributionMonth: string;
  description: string;
  dueOn: string;
  expectedAmount: string;
  note: string;
  projectId: string;
  status: ContributionStatus;
};
type ReceiptDraft = { amount: string; note: string; receivedOn: string };

const modeLabels: Readonly<Record<CommissionMode, string>> = {
  partner_only: "Ortak işlemi tek başına getirdi · %10",
  user_both: "Portföyü ve alıcı/kiracıyı ben getirdim · %50",
  user_one_side: "Portföy veya alıcı/kiracının birini ben getirdim · %25",
};
const modeRates: Readonly<Record<CommissionMode, string>> = {
  partner_only: "0.10",
  user_both: "0.50",
  user_one_side: "0.25",
};
const commissionStatusLabels: Readonly<Record<CommissionStatus, string>> = {
  agency_collected: "Ajans tahsil etti · pay hak edildi",
  cancelled: "İptal",
  expected: "Beklenen işlem",
  paid: "Payım ödendi",
};
const contributionStatusLabels: Readonly<Record<ContributionStatus, string>> = {
  cancelled: "İptal",
  expected: "Bekleniyor",
  partial: "Kısmen alındı",
  received: "Tam alındı",
};

function istanbulToday(): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/Istanbul",
      year: "numeric",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function dueForMonth(month: string): string {
  return `${month}-15`;
}

function canonicalMoney(value: string): string {
  return value.trim().replace(",", ".");
}

function editableMoney(value: string): string {
  const [integer, fraction = ""] = value.split(".", 2);
  const visible = fraction.replace(/0+$/u, "");
  return visible === "" ? integer : `${integer}.${visible}`;
}

function formatMoney(value: string): string {
  try {
    const [integer, fraction] = new Decimal(value).toFixed(2).split(".");
    return `₺${integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ".")},${fraction}`;
  } catch {
    return "—";
  }
}

function formatDate(value: string | null): string {
  if (value === null) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

function defaultProjectId(projects: readonly ProjectDto[]): string {
  return projects.length === 1 ? projects[0]?.id ?? "" : "";
}

function emptyCommission(projects: readonly ProjectDto[]): CommissionDraft {
  return {
    agencyCollectedOn: "",
    closedOn: istanbulToday(),
    commissionBasisAmount: "",
    contributionMode: "partner_only",
    description: "",
    note: "",
    paidOn: "",
    projectId: defaultProjectId(projects),
    status: "expected",
    transactionType: "rental",
  };
}

function emptyContribution(projects: readonly ProjectDto[]): ContributionDraft {
  const month = istanbulToday().slice(0, 7);
  return {
    contributionMonth: month,
    description: "Ofis kirası ortak katkısı",
    dueOn: dueForMonth(month),
    expectedAmount: "7000",
    note: "",
    projectId: defaultProjectId(projects),
    status: "expected",
  };
}

function commissionDraft(record: CommissionDto): CommissionDraft {
  return {
    agencyCollectedOn: record.agencyCollectedOn ?? "",
    closedOn: record.closedOn,
    commissionBasisAmount: editableMoney(record.commissionBasisAmount),
    contributionMode: record.contributionMode,
    description: record.description,
    note: record.note ?? "",
    paidOn: record.paidOn ?? "",
    projectId: record.projectId,
    status: record.status,
    transactionType: record.transactionType,
  };
}

function contributionDraft(record: ContributionDto): ContributionDraft {
  return {
    contributionMonth: record.contributionMonth,
    description: record.description,
    dueOn: record.dueOn,
    expectedAmount: editableMoney(record.expectedAmount),
    note: record.note ?? "",
    projectId: record.projectId,
    status: record.status,
  };
}

function calculateShare(amount: string, mode: CommissionMode): string {
  try {
    return new Decimal(canonicalMoney(amount || "0")).times(modeRates[mode]).toFixed(4);
  } catch {
    return "0.0000";
  }
}

function errorMessage(status: string | undefined, kind: "commission" | "contribution"): string {
  const messages: Readonly<Record<string, string>> = {
    future_actual_date: "Gerçekleşen tahsilat veya ödeme tarihi bugünden ileri olamaz.",
    idempotency_conflict: "Aynı kayıt anahtarı farklı bilgilerle kullanılmış. Formu kapatıp yeniden açın.",
    month_conflict: "Bu ortaklık projesi ve ay için katkı kaydı zaten var.",
    project_type_invalid: "Yalnızca ortaklık türündeki bir proje seçilebilir.",
    record_locked: "Tahsil edilmiş tutarın hesap temeli değiştirilemez; yalnızca ödeme durumu ve not güncellenebilir.",
    status_transition_invalid: "Bu kayıt önceki durumuna geri alınamaz.",
    validation_error: "Alanları, tutarları ve tarih sırasını kontrol edin.",
    version_conflict: "Kayıt başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin.",
  };
  return messages[status ?? ""] ?? `${kind === "commission" ? "Komisyon" : "Katkı"} kaydedilemedi. Yeniden deneyin.`;
}

export function PartnershipWorkspace() {
  const [projects, setProjects] = useState<readonly ProjectDto[]>([]);
  const [commissions, setCommissions] = useState<readonly CommissionDto[]>([]);
  const [contributions, setContributions] = useState<readonly ContributionDto[]>([]);
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">("loading");
  const [revision, setRevision] = useState(0);
  const [projectFilter, setProjectFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState(istanbulToday().slice(0, 7));
  const [commissionEditor, setCommissionEditor] = useState<CommissionDto | "new" | null>(null);
  const [contributionEditor, setContributionEditor] = useState<ContributionDto | "new" | null>(null);
  const [receiptEditor, setReceiptEditor] = useState<ContributionDto | null>(null);
  const [commissionForm, setCommissionForm] = useState<CommissionDraft>(() => emptyCommission([]));
  const [contributionForm, setContributionForm] = useState<ContributionDraft>(() => emptyContribution([]));
  const [receiptForm, setReceiptForm] = useState<ReceiptDraft>({ amount: "", note: "", receivedOn: istanbulToday() });
  const [saveState, setSaveState] = useState<"commission" | "contribution" | "receipt" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const commissionOperation = useRef<string | null>(null);
  const contributionOperation = useRef<string | null>(null);
  const receiptOperation = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const projectResponse = await fetch("/api/projects", { cache: "no-store", credentials: "same-origin", signal });
    if (projectResponse.status === 401) return redirectToLogin();
    if (!projectResponse.ok) throw new Error("Projects unavailable");
    const projectPayload = (await projectResponse.json()) as { projects?: ProjectDto[] };
    const partnershipProjects = (projectPayload.projects ?? []).filter((project) => project.projectType === "partnership");

    const commissionResponse = await fetch("/api/finance/partnership/commissions", { cache: "no-store", credentials: "same-origin", signal });
    if (commissionResponse.status === 401) return redirectToLogin();
    if (!commissionResponse.ok) throw new Error("Commissions unavailable");
    const commissionPayload = (await commissionResponse.json()) as { commissions?: CommissionDto[] };

    const contributionResponse = await fetch("/api/finance/partnership/contributions", { cache: "no-store", credentials: "same-origin", signal });
    if (contributionResponse.status === 401) return redirectToLogin();
    if (!contributionResponse.ok) throw new Error("Contributions unavailable");
    const contributionPayload = (await contributionResponse.json()) as { contributions?: ContributionDto[] };

    if (!Array.isArray(projectPayload.projects) || !Array.isArray(commissionPayload.commissions) || !Array.isArray(contributionPayload.contributions)) {
      throw new Error("Partnership response invalid");
    }
    setProjects(partnershipProjects);
    setCommissions(commissionPayload.commissions);
    setContributions(contributionPayload.contributions);
    setProjectFilter((current) => current === "all" && partnershipProjects.length === 1 ? partnershipProjects[0]?.id ?? "all" : current);
    setLoadState("ready");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => load(controller.signal))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProjects([]);
        setCommissions([]);
        setContributions([]);
        setLoadState("error");
      });
    return () => controller.abort();
  }, [load, revision]);

  const visibleCommissions = useMemo(
    () => commissions.filter((record) =>
      (projectFilter === "all" || record.projectId === projectFilter) &&
      (monthFilter === "" || record.closedOn.slice(0, 7) === monthFilter)),
    [commissions, monthFilter, projectFilter],
  );
  const visibleContributions = useMemo(
    () => contributions.filter((record) =>
      (projectFilter === "all" || record.projectId === projectFilter) &&
      (monthFilter === "" || record.contributionMonth === monthFilter)),
    [contributions, monthFilter, projectFilter],
  );
  const summary = useMemo(() => {
    const sumCommission = (status: CommissionStatus) => visibleCommissions
      .filter((record) => record.status === status)
      .reduce((value, record) => value.plus(record.shareAmount), new Decimal(0));
    const contributionReceived = visibleContributions
      .filter((record) => record.status !== "cancelled")
      .reduce((value, record) => value.plus(record.receivedAmount), new Decimal(0));
    const contributionExpected = visibleContributions
      .filter((record) => record.status !== "cancelled")
      .reduce((value, record) => value.plus(record.expectedAmount), new Decimal(0));
    return {
      contributionOutstanding: contributionExpected.minus(contributionReceived).toFixed(4),
      earnedCommission: sumCommission("agency_collected").toFixed(4),
      expectedCommission: sumCommission("expected").toFixed(4),
      paidCommission: sumCommission("paid").toFixed(4),
    };
  }, [visibleCommissions, visibleContributions]);

  function openNewCommission(): void {
    setCommissionEditor("new");
    setContributionEditor(null);
    setReceiptEditor(null);
    setCommissionForm(emptyCommission(projects));
    setFormError(null);
    commissionOperation.current = null;
  }
  function openCommission(record: CommissionDto): void {
    setCommissionEditor(record);
    setContributionEditor(null);
    setReceiptEditor(null);
    setCommissionForm(commissionDraft(record));
    setFormError(null);
  }
  function openNewContribution(): void {
    setContributionEditor("new");
    setCommissionEditor(null);
    setReceiptEditor(null);
    setContributionForm(emptyContribution(projects));
    setFormError(null);
    contributionOperation.current = null;
  }
  function openContribution(record: ContributionDto): void {
    setContributionEditor(record);
    setCommissionEditor(null);
    setReceiptEditor(null);
    setContributionForm(contributionDraft(record));
    setFormError(null);
  }
  function openReceipt(record: ContributionDto): void {
    setReceiptEditor(record);
    setCommissionEditor(null);
    setContributionEditor(null);
    setReceiptForm({ amount: "", note: "", receivedOn: istanbulToday() });
    setFormError(null);
    receiptOperation.current = null;
  }
  function closeEditors(): void {
    setCommissionEditor(null);
    setContributionEditor(null);
    setReceiptEditor(null);
    setSaveState(null);
    setFormError(null);
  }

  async function submitCommission(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (commissionForm.projectId === "" || commissionForm.description.trim() === "" || commissionForm.commissionBasisAmount.trim() === "") {
      setFormError("Proje, açıklama ve paylaşım esas komisyonu zorunludur.");
      return;
    }
    const existing = commissionEditor === "new" ? null : commissionEditor;
    if (existing === null && commissionOperation.current === null) commissionOperation.current = globalThis.crypto.randomUUID();
    const body = {
      agencyCollectedOn: nullable(commissionForm.agencyCollectedOn),
      closedOn: commissionForm.closedOn,
      commissionBasisAmount: canonicalMoney(commissionForm.commissionBasisAmount),
      contributionMode: commissionForm.contributionMode,
      description: commissionForm.description.trim(),
      note: nullable(commissionForm.note),
      paidOn: nullable(commissionForm.paidOn),
      projectId: commissionForm.projectId,
      status: commissionForm.status,
      transactionType: commissionForm.transactionType,
    };
    setSaveState("commission");
    setFormError(null);
    try {
      const response = await fetch(existing === null ? "/api/finance/partnership/commissions" : `/api/finance/partnership/commissions/${existing.id}`, {
        body: JSON.stringify(existing === null ? { ...body, clientOperationKey: commissionOperation.current } : { ...body, version: existing.version }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: existing === null ? "POST" : "PATCH",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as { commission?: CommissionDto; status?: string };
      if (!response.ok || payload.commission === undefined) {
        setFormError(errorMessage(payload.status, "commission"));
        setSaveState(null);
        return;
      }
      setCommissions((current) => existing === null ? [payload.commission!, ...current] : current.map((item) => item.id === payload.commission!.id ? payload.commission! : item));
      setAnnouncement(`${payload.commission.description} komisyon kaydı kaydedildi.`);
      commissionOperation.current = null;
      closeEditors();
    } catch {
      setFormError("Komisyon kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState(null);
    }
  }

  async function submitContribution(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (contributionForm.projectId === "" || contributionForm.description.trim() === "") {
      setFormError("Proje ve açıklama zorunludur.");
      return;
    }
    const existing = contributionEditor === "new" ? null : contributionEditor;
    if (existing === null && contributionOperation.current === null) contributionOperation.current = globalThis.crypto.randomUUID();
    const body = {
      contributionMonth: contributionForm.contributionMonth,
      description: contributionForm.description.trim(),
      dueOn: contributionForm.dueOn,
      expectedAmount: canonicalMoney(contributionForm.expectedAmount),
      note: nullable(contributionForm.note),
      projectId: contributionForm.projectId,
      status: existing === null ? "expected" : contributionForm.status,
    };
    setSaveState("contribution");
    setFormError(null);
    try {
      const response = await fetch(existing === null ? "/api/finance/partnership/contributions" : `/api/finance/partnership/contributions/${existing.id}`, {
        body: JSON.stringify(existing === null ? { ...body, clientOperationKey: contributionOperation.current } : { ...body, version: existing.version }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: existing === null ? "POST" : "PATCH",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as { contribution?: ContributionDto; status?: string };
      if (!response.ok || payload.contribution === undefined) {
        setFormError(errorMessage(payload.status, "contribution"));
        setSaveState(null);
        return;
      }
      setContributions((current) => existing === null
        ? [{ ...payload.contribution!, receipts: [] }, ...current]
        : current.map((item) => item.id === payload.contribution!.id
          ? { ...payload.contribution!, receipts: item.receipts }
          : item));
      setAnnouncement(`${payload.contribution.description} katkı kaydı kaydedildi.`);
      contributionOperation.current = null;
      closeEditors();
    } catch {
      setFormError("Katkı kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState(null);
    }
  }

  async function submitReceipt(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (receiptEditor === null || receiptForm.amount.trim() === "") {
      setFormError("Tahsil edilen tutarı girin.");
      return;
    }
    if (receiptOperation.current === null) receiptOperation.current = globalThis.crypto.randomUUID();
    const body = {
      amount: canonicalMoney(receiptForm.amount),
      clientOperationKey: receiptOperation.current,
      note: nullable(receiptForm.note),
      receivedOn: receiptForm.receivedOn,
    };
    setSaveState("receipt");
    setFormError(null);
    try {
      const response = await fetch(`/api/finance/partnership/contributions/${receiptEditor.id}/receipts`, {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        contribution?: Omit<ContributionDto, "receipts">;
        receipt?: ContributionReceiptDto;
        status?: string;
      };
      if (!response.ok || payload.contribution === undefined || payload.receipt === undefined) {
        const receiptMessages: Readonly<Record<string, string>> = {
          contribution_closed: "Tamamlanmış veya iptal edilmiş katkıya yeni tahsilat eklenemez.",
          future_actual_date: "Gerçekleşen tahsilat tarihi bugünden ileri olamaz.",
          idempotency_conflict: "Aynı tahsilat anahtarı farklı bilgilerle kullanılmış. Formu kapatıp yeniden açın.",
          overpayment: "Tahsilat bekleyen katkı tutarını aşamaz.",
          validation_error: "Tahsilat tutarı ve tarihini kontrol edin.",
          version_conflict: "Katkı başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin.",
        };
        setFormError(receiptMessages[payload.status ?? ""] ?? "Tahsilat kaydedilemedi. Yeniden deneyin.");
        setSaveState(null);
        return;
      }
      const updated = payload.contribution;
      const receipt = payload.receipt;
      setContributions((current) => current.map((item) => item.id === updated.id
        ? { ...updated, receipts: [...item.receipts.filter((entry) => entry.id !== receipt.id), receipt].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn)) }
        : item));
      setAnnouncement(`${receiptEditor.description} için ${formatMoney(receipt.amount)} tahsilat kaydedildi.`);
      receiptOperation.current = null;
      closeEditors();
    } catch {
      setFormError("Tahsilat kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState(null);
    }
  }

  const commissionLocked = commissionEditor !== null && commissionEditor !== "new" && commissionEditor.status !== "expected";
  const contributionLocked = contributionEditor !== null && contributionEditor !== "new" && contributionEditor.status !== "expected";
  const liveShare = calculateShare(commissionForm.commissionBasisAmount, commissionForm.contributionMode);
  const commissionStatusOptions = Object.entries(commissionStatusLabels).filter(
    ([status]) =>
      commissionEditor === "new" ||
      commissionEditor === null ||
      commissionEditor.status === "expected" ||
      (commissionEditor.status === "agency_collected" &&
        (status === "agency_collected" || status === "paid")) ||
      status === commissionEditor.status,
  );

  return (
    <section className={styles.workspace} aria-labelledby="partnership-title">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>Ortaklık finansı</p>
          <h2 id="partnership-title">Ortaklık hesabı</h2>
          <p>Komisyon payları ve aylık ortak katkıları birbirinden, giderlerden ve vergiden ayrı izlenir.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={openNewCommission} disabled={projects.length === 0}>+ Komisyon ekle</button>
          <button type="button" onClick={openNewContribution} disabled={projects.length === 0}>+ Katkı ekle</button>
        </div>
      </div>

      {projects.length === 0 && loadState === "ready" ? (
        <div className={styles.notice} role="status">Önce Projeler bölümünde “Ortaklık” türünde bir proje oluşturun.</div>
      ) : null}

      <div className={styles.filters} aria-label="Ortaklık hesabı filtreleri">
        <label><span>Proje</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">Tüm ortaklık projeleri</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.displayName} · {project.shortCode}</option>)}</select></label>
        <label><span>Dönem</span><input aria-label="Ortaklık dönemi" type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} /></label>
        <button className={styles.textButton} type="button" onClick={() => setMonthFilter("")}>Tüm dönemler</button>
      </div>

      <div className={styles.summary} aria-label="Ortaklık hesap özeti">
        <div><span>Beklenen komisyon payı</span><strong>{formatMoney(summary.expectedCommission)}</strong></div>
        <div className={styles.accent}><span>Hak edilmiş, ödenmemiş pay</span><strong>{formatMoney(summary.earnedCommission)}</strong></div>
        <div><span>Ödenmiş komisyon payı</span><strong>{formatMoney(summary.paidCommission)}</strong></div>
        <div><span>Bekleyen ortak katkısı</span><strong>{formatMoney(summary.contributionOutstanding)}</strong></div>
      </div>

      {loadState === "error" ? <div className={styles.error} role="alert">Kayıtlara ulaşılamadı.<button type="button" onClick={() => { setLoadState("loading"); setRevision((value) => value + 1); }}>Yeniden dene</button></div> : null}

      {commissionEditor !== null ? (
        <section className={styles.editor} aria-labelledby="commission-form-title">
          <div className={styles.editorIntro}><p className={styles.kicker}>Komisyon hesabı</p><h3 id="commission-form-title">{commissionEditor === "new" ? "Yeni işlem" : "Komisyonu düzenle"}</h3><p>Pay oranı katkınıza göre otomatik hesaplanır. Hesaplanan pay net alacağınızdır; vergi yükü ortaktadır.</p><strong>{formatMoney(liveShare)} net pay</strong></div>
          <form className={styles.form} onSubmit={(event) => void submitCommission(event)}>
            <label><span>Ortaklık projesi</span><select required disabled={commissionLocked} value={commissionForm.projectId} onChange={(event) => setCommissionForm((value) => ({ ...value, projectId: event.target.value }))}><option value="">Proje seçin</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.displayName}</option>)}</select></label>
            <label><span>İşlem türü</span><select disabled={commissionLocked} value={commissionForm.transactionType} onChange={(event) => setCommissionForm((value) => ({ ...value, transactionType: event.target.value as "rental" | "sale" }))}><option value="rental">Kiralama</option><option value="sale">Satış</option></select></label>
            <label className={styles.wide}><span>İşlem / taşınmaz açıklaması</span><input maxLength={191} required value={commissionForm.description} onChange={(event) => setCommissionForm((value) => ({ ...value, description: event.target.value }))} /></label>
            <label><span>İşlem tarihi</span><input disabled={commissionLocked} required type="date" value={commissionForm.closedOn} onChange={(event) => setCommissionForm((value) => ({ ...value, closedOn: event.target.value }))} /></label>
            <label><span>Paylaşım esas komisyonu (₺)</span><input disabled={commissionLocked} inputMode="decimal" required value={commissionForm.commissionBasisAmount} onChange={(event) => setCommissionForm((value) => ({ ...value, commissionBasisAmount: event.target.value }))} /></label>
            <label className={styles.wide}><span>İşlemi kim getirdi?</span><select disabled={commissionLocked} value={commissionForm.contributionMode} onChange={(event) => setCommissionForm((value) => ({ ...value, contributionMode: event.target.value as CommissionMode }))}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Durum</span><select value={commissionForm.status} onChange={(event) => { const status = event.target.value as CommissionStatus; const today = istanbulToday(); setCommissionForm((value) => ({ ...value, agencyCollectedOn: status === "expected" || status === "cancelled" ? "" : value.agencyCollectedOn || today, paidOn: status === "paid" ? value.paidOn || today : "", status })); }}>{commissionStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {commissionForm.status === "agency_collected" || commissionForm.status === "paid" ? <label><span>Ajans tahsil tarihi</span><input max={istanbulToday()} required type="date" value={commissionForm.agencyCollectedOn} onChange={(event) => setCommissionForm((value) => ({ ...value, agencyCollectedOn: event.target.value }))} /></label> : null}
            {commissionForm.status === "paid" ? <label><span>Payımın ödeme tarihi</span><input max={istanbulToday()} required type="date" value={commissionForm.paidOn} onChange={(event) => setCommissionForm((value) => ({ ...value, paidOn: event.target.value }))} /></label> : null}
            <label className={styles.wide}><span>İç not</span><textarea maxLength={2000} rows={2} value={commissionForm.note} onChange={(event) => setCommissionForm((value) => ({ ...value, note: event.target.value }))} /></label>
            {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
            <div className={styles.formActions}><button className={styles.textButton} disabled={saveState !== null} type="button" onClick={closeEditors}>Vazgeç</button><button disabled={saveState !== null} type="submit">{saveState === "commission" ? "Kaydediliyor…" : "Komisyonu kaydet"}</button></div>
          </form>
        </section>
      ) : null}

      {contributionEditor !== null ? (
        <section className={styles.editor} aria-labelledby="contribution-form-title">
          <div className={styles.editorIntro}><p className={styles.kicker}>Ortak katkısı</p><h3 id="contribution-form-title">{contributionEditor === "new" ? "Yeni aylık katkı" : "Katkıyı düzenle"}</h3><p>Bu kayıt gelir/gider mahsuplaşması değildir. Kira gideri brüt olarak gider defterinde; ortaktan alınan 7.000 ₺ burada ayrı kalır.</p></div>
          <form className={styles.form} onSubmit={(event) => void submitContribution(event)}>
            <label><span>Ortaklık projesi</span><select required disabled={contributionLocked} value={contributionForm.projectId} onChange={(event) => setContributionForm((value) => ({ ...value, projectId: event.target.value }))}><option value="">Proje seçin</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.displayName}</option>)}</select></label>
            <label><span>Katkı ayı</span><input disabled={contributionLocked} required type="month" value={contributionForm.contributionMonth} onChange={(event) => { const contributionMonth = event.target.value; setContributionForm((value) => ({ ...value, contributionMonth, dueOn: dueForMonth(contributionMonth) })); }} /></label>
            <label className={styles.wide}><span>Açıklama</span><input maxLength={191} required value={contributionForm.description} onChange={(event) => setContributionForm((value) => ({ ...value, description: event.target.value }))} /></label>
            <label><span>Beklenen katkı (₺)</span><input disabled={contributionLocked} inputMode="decimal" required value={contributionForm.expectedAmount} onChange={(event) => setContributionForm((value) => ({ ...value, expectedAmount: event.target.value }))} /></label>
            <label><span>Vade</span><input required type="date" value={contributionForm.dueOn} onChange={(event) => setContributionForm((value) => ({ ...value, dueOn: event.target.value }))} /></label>
            <label><span>Durum</span><select disabled={contributionEditor === "new" || contributionForm.status !== "expected"} value={contributionForm.status} onChange={(event) => setContributionForm((value) => ({ ...value, status: event.target.value as ContributionStatus }))}><option value={contributionForm.status}>{contributionStatusLabels[contributionForm.status]}</option>{contributionEditor !== "new" && contributionForm.status === "expected" ? <option value="cancelled">İptal</option> : null}</select></label>
            <label className={styles.wide}><span>İç not</span><textarea maxLength={2000} rows={2} value={contributionForm.note} onChange={(event) => setContributionForm((value) => ({ ...value, note: event.target.value }))} /></label>
            {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
            <div className={styles.formActions}><button className={styles.textButton} disabled={saveState !== null} type="button" onClick={closeEditors}>Vazgeç</button><button disabled={saveState !== null} type="submit">{saveState === "contribution" ? "Kaydediliyor…" : "Katkıyı kaydet"}</button></div>
          </form>
        </section>
      ) : null}

      {receiptEditor !== null ? (
        <section className={styles.editor} aria-labelledby="receipt-form-title">
          <div className={styles.editorIntro}>
            <p className={styles.kicker}>Append-only tahsilat</p>
            <h3 id="receipt-form-title">Katkı tahsilatı ekle</h3>
            <p>{receiptEditor.description} için her tahsilat ayrı saklanır; önceki kısmi ödemelerin tarihi silinmez.</p>
            <strong>{formatMoney(new Decimal(receiptEditor.expectedAmount).minus(receiptEditor.receivedAmount).toFixed(4))} bekliyor</strong>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitReceipt(event)}>
            <label><span>Tahsil edilen tutar (₺)</span><input autoFocus inputMode="decimal" required value={receiptForm.amount} onChange={(event) => setReceiptForm((value) => ({ ...value, amount: event.target.value }))} /></label>
            <label><span>Tahsil tarihi</span><input max={istanbulToday()} required type="date" value={receiptForm.receivedOn} onChange={(event) => setReceiptForm((value) => ({ ...value, receivedOn: event.target.value }))} /></label>
            <label className={styles.wide}><span>Tahsilat notu</span><textarea maxLength={2000} rows={2} value={receiptForm.note} onChange={(event) => setReceiptForm((value) => ({ ...value, note: event.target.value }))} /></label>
            {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
            <div className={styles.formActions}><button className={styles.textButton} disabled={saveState !== null} type="button" onClick={closeEditors}>Vazgeç</button><button disabled={saveState !== null} type="submit">{saveState === "receipt" ? "Kaydediliyor…" : "Tahsilatı kaydet"}</button></div>
          </form>
        </section>
      ) : null}

      <section className={styles.ledger} aria-labelledby="commission-ledger-title"><div className={styles.sectionHeading}><div><p className={styles.kicker}>İşlem bazlı</p><h3 id="commission-ledger-title">Komisyon payları</h3></div><span>{visibleCommissions.length} kayıt</span></div><div className={styles.tableWrap}><table aria-label="Ortaklık komisyon kayıtları"><thead><tr><th>İşlem</th><th>Katkı / oran</th><th>Esas komisyon</th><th>Net payım</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>{visibleCommissions.map((record) => <tr key={record.id}><td data-label="İşlem"><strong>{record.description}</strong><small>{record.transactionType === "sale" ? "Satış" : "Kiralama"} · {formatDate(record.closedOn)} · {record.projectName}</small></td><td data-label="Katkı / oran">{modeLabels[record.contributionMode]} </td><td data-label="Esas komisyon">{formatMoney(record.commissionBasisAmount)}</td><td data-label="Net payım"><strong>{formatMoney(record.shareAmount)}</strong></td><td data-label="Durum"><span className={`${styles.status} ${styles[record.status]}`}>{commissionStatusLabels[record.status]}</span>{record.paidOn ? <small>{formatDate(record.paidOn)}</small> : record.agencyCollectedOn ? <small>{formatDate(record.agencyCollectedOn)}</small> : null}</td><td data-label="İşlem"><button className={styles.rowAction} type="button" onClick={() => openCommission(record)}>Düzenle</button></td></tr>)}{visibleCommissions.length === 0 ? <tr><td className={styles.empty} colSpan={6}>{loadState === "loading" ? "Komisyonlar yükleniyor…" : "Bu kapsamda komisyon kaydı yok."}</td></tr> : null}</tbody></table></div></section>

      <section className={styles.ledger} aria-labelledby="contribution-ledger-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>Aylık ortak hesabı</p><h3 id="contribution-ledger-title">Ortak katkıları</h3></div>
          <span>{visibleContributions.length} kayıt</span>
        </div>
        <div className={styles.tableWrap}>
          <table aria-label="Ortak katkı kayıtları">
            <thead><tr><th>Dönem</th><th>Açıklama</th><th>Beklenen</th><th>Alınan / tarihçe</th><th>Vade / durum</th><th>İşlem</th></tr></thead>
            <tbody>
              {visibleContributions.map((record) => (
                <tr key={record.id}>
                  <td data-label="Dönem"><strong>{record.contributionMonth}</strong><small>{record.projectName}</small></td>
                  <td data-label="Açıklama">{record.description}</td>
                  <td data-label="Beklenen">{formatMoney(record.expectedAmount)}</td>
                  <td data-label="Alınan / tarihçe">
                    <strong>{formatMoney(record.receivedAmount)}</strong>
                    {record.receipts.map((receipt) => <small key={receipt.id}>{formatDate(receipt.receivedOn)} · {formatMoney(receipt.amount)}</small>)}
                  </td>
                  <td data-label="Vade / durum"><span className={`${styles.status} ${styles[record.status]}`}>{contributionStatusLabels[record.status]}</span><small>{formatDate(record.dueOn)}</small></td>
                  <td data-label="İşlem">
                    <div className={styles.rowActions}>
                      {record.status === "expected" || record.status === "partial" ? <button className={styles.rowAction} type="button" onClick={() => openReceipt(record)}>Tahsilat ekle</button> : null}
                      <button className={styles.rowAction} type="button" onClick={() => openContribution(record)}>Düzenle</button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleContributions.length === 0 ? <tr><td className={styles.empty} colSpan={6}>{loadState === "loading" ? "Katkılar yükleniyor…" : "Bu kapsamda katkı kaydı yok."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
