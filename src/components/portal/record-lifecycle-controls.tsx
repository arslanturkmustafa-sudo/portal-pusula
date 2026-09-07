"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

import styles from "./record-lifecycle-controls.module.css";

export type RecordLifecycleRequest =
  | Readonly<{
      action: "archive" | "cancel" | "restore";
      endpoint: string;
      kind: "lifecycle";
      version: number;
    }>
  | Readonly<{
      endpoint: string;
      kind: "expense-void";
      version: number;
    }>
  | Readonly<{
      endpoint: string;
      kind: "receivable-void";
      version: number;
    }>
  | Readonly<{
      endpoint: string;
      kind: "reverse";
    }>;

export type RecordLifecycleAction = Readonly<{
  description: string;
  id: string;
  label: string;
  request: RecordLifecycleRequest;
  tone?: "danger" | "neutral";
}>;

type AuditValue = boolean | number | string | null | readonly string[];

type AuditEvent = Readonly<{
  action: string;
  actorLabel: string;
  after: Readonly<Record<string, AuditValue>> | null;
  before: Readonly<Record<string, AuditValue>> | null;
  id: string;
  occurredAtUtc: string;
}>;

type RecordLifecycleControlsProps = Readonly<{
  actions?: readonly RecordLifecycleAction[];
  canReadHistory?: boolean;
  entityId: string;
  entityLabel: string;
  entityType:
    | "consulting_contract"
    | "customer"
    | "expense"
    | "finance_account"
    | "finance_transaction"
    | "partnership_contribution"
    | "partnership_contribution_receipt"
    | "partnership_commission"
    | "project"
    | "receivable"
    | "receivable_collection"
    | "work_task";
  onSuccess?: () => void | Promise<void>;
}>;

type DialogView = "action" | "history" | null;

const auditActionLabels: Readonly<Record<string, string>> = {
  archive: "Arşivlendi",
  cancel: "İptal edildi",
  "consulting_contract.archived": "Sözleşme arşivlendi",
  "consulting_contract.created": "Sözleşme oluşturuldu",
  "consulting_contract.restored": "Sözleşme arşivden çıkarıldı",
  "consulting_contract.updated": "Sözleşme güncellendi",
  create: "Oluşturuldu",
  "customer.archived": "Müşteri arşivlendi",
  "customer.created": "Müşteri oluşturuldu",
  "customer.restored": "Müşteri arşivden çıkarıldı",
  "customer.updated": "Müşteri güncellendi",
  "expense.created": "Gider oluşturuldu",
  "expense.updated": "Gider güncellendi",
  "expense.voided": "Gider geçersiz kılındı",
  "finance_account.created": "Finans hesabı oluşturuldu",
  "finance_account.deactivated": "Finans hesabı pasife alındı",
  "finance_account.updated": "Finans hesabı güncellendi",
  "finance_transaction.created": "Hesap hareketi oluşturuldu",
  "finance_transaction.reversed": "Hesap hareketi ters kaydedildi",
  "partnership_contribution.receipt_added": "Ortaklık tahsilatı eklendi",
  "partnership_contribution.receipt_reversed": "Ortaklık tahsilatı ters kaydedildi",
  "project.archived": "Proje arşivlendi",
  "project.restored": "Proje arşivden çıkarıldı",
  "receivable.collection_created": "Tahsilat eklendi",
  "receivable.collection_reversed": "Tahsilat ters kaydedildi",
  "receivable.contract_month_generated": "Aylık alacak oluşturuldu",
  "receivable.opening_balance_created": "Açılış bakiyesi oluşturuldu",
  "receivable.voided": "Alacak geçersiz kılındı",
  restore: "Geri alındı",
  reverse: "Ters kayıt oluşturuldu",
  "task.archived": "Görev arşivlendi",
  "task.restored": "Görev arşivden çıkarıldı",
  update: "Güncellendi",
  void: "Geçersiz kılındı",
};

const auditKeyLabels: Readonly<Record<string, string>> = {
  amount: "Tutar",
  category: "Kategori",
  collectedAmount: "Tahsil edilen",
  completedAtUtc: "Tamamlanma zamanı",
  description: "Açıklama",
  displayName: "Ad",
  accountType: "Hesap türü",
  dueOn: "Vade",
  endsOn: "Bitiş",
  incurredOn: "Harcama tarihi",
  openingBalanceAmount: "Açılış bakiyesi",
  occurredOn: "İşlem tarihi",
  monthlyFeeAmount: "Aylık ücret",
  outstandingAmount: "Kalan tutar",
  originalCollectionId: "Özgün tahsilat",
  paymentDay: "Ödeme günü",
  periodMonth: "Dönem",
  priority: "Öncelik",
  recordState: "Kayıt durumu",
  reason: "Gerekçe",
  reversalOfId: "Terslenen kayıt",
  reversalId: "Ters kayıt",
  reversalReason: "Ters kayıt gerekçesi",
  sourceAccountId: "Kaynak hesap",
  startsOn: "Başlangıç",
  status: "Durum",
  title: "Başlık",
  totalAmount: "Toplam",
  targetAccountId: "Hedef hesap",
  transactionType: "Hareket türü",
  version: "Sürüm",
  voidReason: "Geçersiz kılma gerekçesi",
};

const auditDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

function responseErrorMessage(status: number): string {
  if (status === 401) return "Oturumunuz sona erdi. Yeniden giriş yapın.";
  if (status === 403) return "Bu işlem için yetkiniz bulunmuyor.";
  if (status === 404 || status === 405) {
    return "Bu işlem henüz bu kayıt için kullanıma açık değil.";
  }
  if (status === 409) {
    return "Kayıt başka bir işlemde değişti. Listeyi yenileyip tekrar deneyin.";
  }
  if (status === 422) return "Kayıt bu durumdayken işlem uygulanamıyor.";
  return "İşlem tamamlanamadı. Kayıt değiştirilmedi; tekrar deneyin.";
}

function requestBody(
  request: RecordLifecycleRequest,
  reason: string,
): Readonly<Record<string, number | string>> {
  if (request.kind === "lifecycle") {
    return { action: request.action, reason, version: request.version };
  }
  if (request.kind === "expense-void") {
    return { status: "voided", version: request.version, voidReason: reason };
  }
  if (request.kind === "receivable-void") {
    return { action: "void", reason, version: request.version };
  }
  return { clientOperationKey: globalThis.crypto.randomUUID(), reason };
}

function requestMethod(request: RecordLifecycleRequest): "PATCH" | "POST" {
  return request.kind === "expense-void" ? "PATCH" : "POST";
}

function safeAuditEvents(value: unknown): readonly AuditEvent[] {
  if (typeof value !== "object" || value === null || !("events" in value)) {
    return [];
  }
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.filter((event): event is AuditEvent => {
    if (typeof event !== "object" || event === null) return false;
    const candidate = event as Partial<AuditEvent>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.action === "string" &&
      typeof candidate.actorLabel === "string" &&
      typeof candidate.occurredAtUtc === "string"
    );
  });
}

function changedKeys(event: AuditEvent): readonly string[] {
  const keys = new Set([
    ...Object.keys(event.before ?? {}),
    ...Object.keys(event.after ?? {}),
  ]);
  return [...keys].filter(
    (key) =>
      JSON.stringify(event.before?.[key]) !== JSON.stringify(event.after?.[key]),
  );
}

function displayAuditValue(value: AuditValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "Boş";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function trapTab(
  event: ReactKeyboardEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
): void {
  if (event.key !== "Tab" || !container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1) ?? first;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function RecordLifecycleControls({
  actions = [],
  canReadHistory = false,
  entityId,
  entityLabel,
  entityType,
  onSuccess,
}: RecordLifecycleControlsProps) {
  const [view, setView] = useState<DialogView>(null);
  const [selectedAction, setSelectedAction] =
    useState<RecordLifecycleAction | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [historyState, setHistoryState] =
    useState<"error" | "idle" | "loading" | "ready">("idle");
  const [historyEvents, setHistoryEvents] = useState<readonly AuditEvent[]>([]);
  const titleId = useId();
  const descriptionId = useId();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  function closeDialog(): void {
    if (submitting) return;
    setView(null);
    setSelectedAction(null);
    setReason("");
    setError(null);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  useEffect(() => {
    if (view === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (view === "action") reasonRef.current?.focus();
    else dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [view]);

  async function loadHistory(): Promise<void> {
    setHistoryState("loading");
    setError(null);
    try {
      const query = new URLSearchParams({ entityId, entityType });
      const response = await fetch(`/api/audit?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        redirectToPortalLogin();
        setHistoryState("error");
        return;
      }
      if (!response.ok) {
        setError(responseErrorMessage(response.status));
        setHistoryState("error");
        return;
      }
      setHistoryEvents(safeAuditEvents(await response.json()));
      setHistoryState("ready");
    } catch {
      setError("İşlem geçmişi yüklenemedi. Tekrar deneyin.");
      setHistoryState("error");
    }
  }

  function openHistory(trigger: HTMLElement): void {
    returnFocusRef.current = trigger;
    if (menuRef.current) menuRef.current.open = false;
    setView("history");
    void loadHistory();
  }

  function openAction(
    action: RecordLifecycleAction,
    trigger: HTMLElement,
  ): void {
    returnFocusRef.current = trigger;
    if (menuRef.current) menuRef.current.open = false;
    setSelectedAction(action);
    setReason("");
    setError(null);
    setView("action");
  }

  async function submitAction(): Promise<void> {
    const action = selectedAction;
    const normalizedReason = reason.trim();
    if (!action || normalizedReason.length < 3) {
      setError("İşlem gerekçesi en az 3 karakter olmalıdır.");
      reasonRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(action.request.endpoint, {
        body: JSON.stringify(requestBody(action.request, normalizedReason)),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: requestMethod(action.request),
      });
      if (response.status === 401) {
        redirectToPortalLogin();
        return;
      }
      if (!response.ok) {
        setError(responseErrorMessage(response.status));
        return;
      }
      setView(null);
      setSelectedAction(null);
      setReason("");
      await onSuccess?.();
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    } catch {
      setError("İşlem tamamlanamadı. Kayıt değiştirilmedi; tekrar deneyin.");
    } finally {
      setSubmitting(false);
    }
  }

  if (actions.length === 0 && !canReadHistory) return null;

  return (
    <div className={styles.root}>
      <details className={styles.menu} ref={menuRef}>
        <summary className={styles.menuTrigger}>İşlemler</summary>
        <div className={styles.menuPanel}>
          {actions.map((action) => (
            <button
              className={action.tone === "danger" ? styles.dangerItem : styles.menuItem}
              key={action.id}
              onClick={(event) => openAction(action, event.currentTarget)}
              type="button"
            >
              {action.label}
            </button>
          ))}
          {canReadHistory ? (
            <button
              className={styles.menuItem}
              onClick={(event) => openHistory(event.currentTarget)}
              type="button"
            >
              İşlem geçmişi
            </button>
          ) : null}
        </div>
      </details>

      {view !== null ? (
        <div
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-modal="true"
          className={styles.backdrop}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeDialog();
            trapTab(event, dialogRef.current);
          }}
          role="dialog"
        >
          <div
            className={view === "history" ? styles.drawer : styles.dialog}
            ref={dialogRef}
          >
            <header className={styles.dialogHeader}>
              <div>
                <p className={styles.eyebrow}>{entityLabel}</p>
                <h2 id={titleId}>
                  {view === "history"
                    ? "İşlem geçmişi"
                    : selectedAction?.label}
                </h2>
              </div>
              <button
                aria-label="Pencereyi kapat"
                className={styles.closeButton}
                disabled={submitting}
                onClick={closeDialog}
                type="button"
              >
                ×
              </button>
            </header>

            {view === "action" && selectedAction ? (
              <div className={styles.dialogBody}>
                <p id={descriptionId}>{selectedAction.description}</p>
                <label className={styles.reasonField}>
                  <span>İşlem gerekçesi</span>
                  <textarea
                    aria-invalid={error !== null}
                    disabled={submitting}
                    maxLength={1_000}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Daha sonra anlaşılabilecek kısa bir gerekçe yazın"
                    ref={reasonRef}
                    required
                    rows={4}
                    value={reason}
                  />
                </label>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                <div className={styles.dialogActions}>
                  <button disabled={submitting} onClick={closeDialog} type="button">
                    Vazgeç
                  </button>
                  <button
                    className={selectedAction.tone === "danger" ? styles.dangerButton : styles.primaryButton}
                    disabled={submitting}
                    onClick={() => void submitAction()}
                    type="button"
                  >
                    {submitting ? "İşleniyor…" : "Onayla"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.historyBody} id={descriptionId}>
                {historyState === "loading" ? (
                  <p aria-live="polite">Geçmiş yükleniyor…</p>
                ) : null}
                {historyState === "error" ? (
                  <div className={styles.emptyState}>
                    <p className={styles.error} role="alert">{error}</p>
                    <button onClick={() => void loadHistory()} type="button">
                      Yeniden dene
                    </button>
                  </div>
                ) : null}
                {historyState === "ready" && historyEvents.length === 0 ? (
                  <p className={styles.emptyState}>Bu kayıt için henüz işlem geçmişi yok.</p>
                ) : null}
                {historyState === "ready" && historyEvents.length > 0 ? (
                  <ol className={styles.timeline}>
                    {historyEvents.map((event) => {
                      const keys = changedKeys(event);
                      return (
                        <li key={event.id}>
                          <div className={styles.eventHeading}>
                            <strong>{auditActionLabels[event.action] ?? event.action}</strong>
                            <time dateTime={event.occurredAtUtc}>
                              {auditDateFormatter.format(new Date(event.occurredAtUtc))}
                            </time>
                          </div>
                          <p>{event.actorLabel}</p>
                          {keys.length > 0 ? (
                            <dl className={styles.changes}>
                              {keys.map((key) => (
                                <div key={key}>
                                  <dt>{auditKeyLabels[key] ?? key}</dt>
                                  <dd>
                                    <span>{displayAuditValue(event.before?.[key])}</span>
                                    <span aria-hidden="true">→</span>
                                    <span>{displayAuditValue(event.after?.[key])}</span>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
