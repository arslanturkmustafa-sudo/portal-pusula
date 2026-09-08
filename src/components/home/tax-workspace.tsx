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

import styles from "@/components/home/tax-workspace.module.css";
import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

type LoadState = "error" | "loading" | "ready";
type TaxStatus = "paid" | "planned" | "voided";
type TaxType = "income_tax" | "provisional_tax" | "vat";

type VatEstimate = Readonly<{
  basis: Readonly<{
    input: "active_expense_incurred_period";
    openingBalancesIncluded: false;
    output: "active_contract_receivable_period";
  }>;
  periodMonth: string;
  sourceExpenseCount: number;
  sourceReceivableCount: number;
  systemInputVatAmount: string;
  systemNetVatAmount: string;
  systemOutputVatAmount: string;
}>;

type TaxView = Readonly<{
  accountantAmount: string | null;
  carriedVatCreditAmount: string;
  closingVatCreditAmount: string;
  currency: "TRY";
  description: string;
  dueOn: string;
  id: string;
  manualAdjustmentAmount: string;
  note: string | null;
  paidOn: string | null;
  payableAmount: string;
  periodMonth: string;
  status: TaxStatus;
  systemInputVatAmount: string;
  systemNetVatAmount: string;
  systemOutputVatAmount: string;
  taxType: TaxType;
  version: number;
}>;

type TaxPayload = Readonly<{
  selectedPeriodMonth: string;
  summary: Readonly<{
    closingVatCreditAmount: string;
    currency: "TRY";
    overdueAmount: string;
    paidAmount: string;
    plannedAmount: string;
  }>;
  taxes: readonly TaxView[];
  vatEstimate: VatEstimate;
}>;

type TaxDraft = {
  accountantAmount: string;
  carriedVatCreditAmount: string;
  description: string;
  dueOn: string;
  manualAdjustmentAmount: string;
  note: string;
  paidOn: string;
  periodMonth: string;
  status: TaxStatus;
  taxType: TaxType;
  voidReason: string;
};

const moneyFormatter = new Intl.NumberFormat("tr-TR", {
  currency: "TRY",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

function istanbulToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentIstanbulMonth(): string {
  return istanbulToday().slice(0, 7);
}

function formatMoney(value: string): string {
  try {
    return moneyFormatter.format(new Decimal(value).toNumber());
  } catch {
    return "—";
  }
}

function formatSignedMoney(value: string): string {
  try {
    const amount = new Decimal(value);
    return `${amount.isPositive() ? "+" : ""}${formatMoney(amount.toFixed(4))}`;
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

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function typeLabel(type: TaxType): string {
  return {
    income_tax: "Gelir vergisi",
    provisional_tax: "Geçici vergi",
    vat: "KDV",
  }[type];
}

function statusPresentation(tax: TaxView): Readonly<{ className: string; label: string }> {
  if (tax.status === "planned" && tax.dueOn < istanbulToday()) {
    return { className: "overdue", label: "Gecikti" };
  }
  return {
    paid: { className: "paid", label: "Ödendi" },
    planned: { className: "planned", label: "Planlandı" },
    voided: { className: "voided", label: "İptal" },
  }[tax.status];
}

function normalizeMoney(value: string, fallback = "0"): string {
  const normalized = value.trim().replace(",", ".");
  return normalized === "" ? fallback : normalized;
}

function defaultDescription(type: TaxType, periodMonth: string): string {
  return `${formatMonth(periodMonth)} ${typeLabel(type)}`;
}

function createDraft(periodMonth: string, type: TaxType = "vat"): TaxDraft {
  return {
    accountantAmount: "",
    carriedVatCreditAmount: "0",
    description: defaultDescription(type, periodMonth),
    dueOn: "",
    manualAdjustmentAmount: "0",
    note: "",
    paidOn: istanbulToday(),
    periodMonth,
    status: "planned",
    taxType: type,
    voidReason: "",
  };
}

function draftFromTax(tax: TaxView): TaxDraft {
  return {
    accountantAmount: tax.accountantAmount ?? tax.payableAmount,
    carriedVatCreditAmount: tax.carriedVatCreditAmount,
    description: tax.description,
    dueOn: tax.dueOn,
    manualAdjustmentAmount: tax.manualAdjustmentAmount,
    note: tax.note ?? "",
    paidOn: tax.paidOn ?? istanbulToday(),
    periodMonth: tax.periodMonth,
    status: tax.status,
    taxType: tax.taxType,
    voidReason: "",
  };
}

function calculateVatResult(
  systemNet: string,
  carriedCredit: string,
  manualAdjustment: string,
): Readonly<{ closingCredit: string; payable: string }> {
  try {
    const adjusted = new Decimal(systemNet)
      .minus(normalizeMoney(carriedCredit))
      .plus(normalizeMoney(manualAdjustment));
    return {
      closingCredit: Decimal.max(adjusted.negated(), 0).toFixed(4),
      payable: Decimal.max(adjusted, 0).toFixed(4),
    };
  } catch {
    return { closingCredit: "0", payable: "0" };
  }
}

function taxMutationBody(tax: TaxView, status: TaxStatus, paidOn: string | null) {
  const common = {
    description: tax.description,
    dueOn: tax.dueOn,
    note: tax.note,
    paidOn,
    periodMonth: tax.periodMonth,
    status,
    taxType: tax.taxType,
    version: tax.version,
    voidReason: null,
  };
  return tax.taxType === "vat"
    ? {
        ...common,
        carriedVatCreditAmount: tax.carriedVatCreditAmount,
        manualAdjustmentAmount: tax.manualAdjustmentAmount,
      }
    : { ...common, accountantAmount: tax.accountantAmount ?? tax.payableAmount };
}

export function TaxWorkspace({ canWrite }: Readonly<{ canWrite: boolean }>) {
  const [periodMonth, setPeriodMonth] = useState(currentIstanbulMonth);
  const [payload, setPayload] = useState<TaxPayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [revision, setRevision] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<TaxView | null>(null);
  const [draft, setDraft] = useState<TaxDraft>(() => createDraft(currentIstanbulMonth()));
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const operationRef = useRef<Readonly<{ fingerprint: string; key: string }> | null>(null);

  const loadTaxes = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ periodMonth });
    const response = await fetch(`/api/finance/taxes?${query.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (response.status === 401) return redirectToPortalLogin();
    if (!response.ok) throw new Error("Taxes are unavailable.");
    const next = (await response.json()) as Partial<TaxPayload>;
    if (
      !Array.isArray(next.taxes) ||
      next.summary === undefined ||
      next.vatEstimate === undefined
    ) {
      throw new Error("Tax response is invalid.");
    }
    setPayload(next as TaxPayload);
    setError(null);
    setLoadState("ready");
  }, [periodMonth]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => loadTaxes(controller.signal))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setPayload(null);
        setError("Vergi bilgilerine ulaşılamadı. Bağlantıyı kontrol edin.");
        setLoadState("error");
      });
    return () => controller.abort();
  }, [loadTaxes, revision]);

  useEffect(() => {
    if (!editorOpen) return;
    editorHeadingRef.current?.scrollIntoView?.({ block: "start" });
    editorHeadingRef.current?.focus({ preventScroll: true });
  }, [editorOpen, editingTax]);

  const periodTaxes = useMemo(
    () =>
      payload?.taxes.filter(
        (tax) => tax.periodMonth === payload.selectedPeriodMonth,
      ) ?? [],
    [payload],
  );
  const vatRecord = useMemo(
    () => periodTaxes.find((tax) => tax.taxType === "vat") ?? null,
    [periodTaxes],
  );
  const activeVat = vatRecord?.status === "voided" ? null : vatRecord;
  const vatNeedsRefresh =
    activeVat !== null &&
    payload !== null &&
    (activeVat.systemOutputVatAmount !== payload.vatEstimate.systemOutputVatAmount ||
      activeVat.systemInputVatAmount !== payload.vatEstimate.systemInputVatAmount);

  const vatValues = useMemo(() => {
    if (payload === null) return null;
    const carried = activeVat?.carriedVatCreditAmount ?? "0";
    const manual = activeVat?.manualAdjustmentAmount ?? "0";
    return {
      carried,
      manual,
      ...calculateVatResult(payload.vatEstimate.systemNetVatAmount, carried, manual),
    };
  }, [activeVat, payload]);

  const formVatPreview = useMemo(() => {
    if (payload === null || draft.periodMonth !== periodMonth) return null;
    return calculateVatResult(
      payload.vatEstimate.systemNetVatAmount,
      draft.carriedVatCreditAmount,
      draft.manualAdjustmentAmount,
    );
  }, [draft.carriedVatCreditAmount, draft.manualAdjustmentAmount, draft.periodMonth, payload, periodMonth]);

  function openCreate(type: TaxType = "vat"): void {
    setEditingTax(null);
    setDraft(createDraft(periodMonth, type));
    setFormError(null);
    setEditorOpen(true);
    operationRef.current = null;
  }

  function openEdit(tax: TaxView): void {
    setEditingTax(tax);
    setDraft(draftFromTax(tax));
    setFormError(null);
    setEditorOpen(true);
    operationRef.current = null;
  }

  function closeEditor(): void {
    setEditorOpen(false);
    setEditingTax(null);
    setFormError(null);
    setSaving(false);
    operationRef.current = null;
  }

  function updateDraft(next: Partial<TaxDraft>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function submitTax(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft.description.trim() === "" || draft.dueOn === "") {
      setFormError("Açıklama ve vade tarihi zorunludur.");
      return;
    }
    if (draft.taxType !== "vat" && draft.accountantAmount.trim() === "") {
      setFormError("Muhasebecinin bildirdiği tutar zorunludur.");
      return;
    }
    if (draft.status === "voided" && draft.voidReason.trim().length < 3) {
      setFormError("İptal nedeni en az 3 karakter olmalıdır.");
      return;
    }

    const common = {
      description: draft.description.trim(),
      dueOn: draft.dueOn,
      note: draft.note.trim() === "" ? null : draft.note.trim(),
      periodMonth: draft.periodMonth,
      taxType: draft.taxType,
    };
    const amounts = draft.taxType === "vat"
      ? {
          carriedVatCreditAmount: normalizeMoney(draft.carriedVatCreditAmount),
          manualAdjustmentAmount: normalizeMoney(draft.manualAdjustmentAmount),
        }
      : { accountantAmount: normalizeMoney(draft.accountantAmount) };
    const existing = editingTax;
    const editable = existing === null
      ? { ...common, ...amounts }
      : {
          ...common,
          ...amounts,
          paidOn: draft.status === "paid" ? draft.paidOn : null,
          status: draft.status,
          version: existing.version,
          voidReason: draft.status === "voided" ? draft.voidReason.trim() : null,
        };
    const fingerprint = JSON.stringify(editable);
    if (
      existing === null &&
      (operationRef.current === null || operationRef.current.fingerprint !== fingerprint)
    ) {
      operationRef.current = { fingerprint, key: globalThis.crypto.randomUUID() };
    }

    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(
        existing === null ? "/api/finance/taxes" : `/api/finance/taxes/${existing.id}`,
        {
          body: JSON.stringify(
            existing === null
              ? { ...editable, clientOperationKey: operationRef.current?.key }
              : editable,
          ),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: existing === null ? "POST" : "PATCH",
        },
      );
      if (response.status === 401) return redirectToPortalLogin();
      const result = (await response.json().catch(() => ({}))) as { tax?: TaxView };
      if (!response.ok || result.tax === undefined) {
        setFormError(
          response.status === 409
            ? existing === null
              ? "Bu dönem için aynı vergi türünde bir kayıt zaten var."
              : "Kayıt başka bir işlemde değişti. Listeyi yenileyip yeniden deneyin."
            : "Vergi kaydı kaydedilemedi. Alanları kontrol edin.",
        );
        return;
      }
      setAnnouncement(
        existing === null
          ? `${typeLabel(result.tax.taxType)} kaydı oluşturuldu.`
          : `${typeLabel(result.tax.taxType)} kaydı güncellendi.`,
      );
      closeEditor();
      setRevision((current) => current + 1);
    } catch {
      setFormError("Vergi kaydı kaydedilemedi. Bağlantıyı kontrol edin.");
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(tax: TaxView): Promise<void> {
    setUpdatingId(tax.id);
    setError(null);
    try {
      const response = await fetch(`/api/finance/taxes/${tax.id}`, {
        body: JSON.stringify(taxMutationBody(tax, "paid", istanbulToday())),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) return redirectToPortalLogin();
      if (!response.ok) throw new Error("Tax could not be updated.");
      setAnnouncement(`${typeLabel(tax.taxType)} ödendi olarak işaretlendi.`);
      setRevision((current) => current + 1);
    } catch {
      setError("Ödeme durumu güncellenemedi. Yeniden deneyin.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className={styles.workspace}>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <header className={styles.commandBar}>
        <div>
          <p className={styles.kicker}>Vergi kontrol masası</p>
          <h2>Vadeyi ve gerçek yükü birlikte görün</h2>
          <p>
            Sistem KDV tahminini hazırlar; devreden alacak ve muhasebeci
            düzeltmeleri sizin kontrolünüzde kalır.
          </p>
        </div>
        <div className={styles.commandActions}>
          <label>
            <span>Dönem</span>
            <input
              aria-label="Vergi dönemi"
              type="month"
              value={periodMonth}
              onChange={(event) => {
                if (event.target.value === "") return;
                setPayload(null);
                setEditorOpen(false);
                setLoadState("loading");
                setPeriodMonth(event.target.value);
              }}
            />
          </label>
          {canWrite ? (
            <button className={styles.primaryButton} type="button" onClick={() => openCreate()}>
              Yeni vergi kaydı
            </button>
          ) : null}
        </div>
      </header>

      {error === null ? null : (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {loadState === "error" ? (
            <button
              type="button"
              onClick={() => {
                setLoadState("loading");
                setRevision((current) => current + 1);
              }}
            >
              Yeniden dene
            </button>
          ) : null}
        </div>
      )}

      {editorOpen ? (
        <section className={styles.editor} aria-labelledby="tax-editor-title">
          <div className={styles.editorHeading}>
            <div>
              <p className={styles.kicker}>{editingTax === null ? "Yeni kayıt" : "Kaydı düzenle"}</p>
              <h3 id="tax-editor-title" ref={editorHeadingRef} tabIndex={-1}>
                {editingTax === null ? "Vergi planı oluştur" : editingTax.description}
              </h3>
            </div>
            <button className={styles.quietButton} disabled={saving} type="button" onClick={closeEditor}>
              Kapat
            </button>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitTax(event)}>
            <label>
              <span>Vergi türü</span>
              <select
                disabled={editingTax !== null}
                value={draft.taxType}
                onChange={(event) => {
                  const taxType = event.target.value as TaxType;
                  updateDraft({
                    description: defaultDescription(taxType, draft.periodMonth),
                    taxType,
                  });
                }}
              >
                <option value="vat">KDV</option>
                <option value="income_tax">Gelir vergisi</option>
                <option value="provisional_tax">Geçici vergi</option>
              </select>
            </label>
            <label>
              <span>Vergi dönemi</span>
              <input
                required
                type="month"
                value={draft.periodMonth}
                onChange={(event) => {
                  const nextPeriod = event.target.value;
                  updateDraft({
                    description:
                      draft.description === defaultDescription(draft.taxType, draft.periodMonth)
                        ? defaultDescription(draft.taxType, nextPeriod)
                        : draft.description,
                    periodMonth: nextPeriod,
                  });
                }}
              />
            </label>
            <label>
              <span>Vade tarihi</span>
              <input
                required
                type="date"
                value={draft.dueOn}
                onChange={(event) => updateDraft({ dueOn: event.target.value })}
              />
            </label>
            <label className={styles.wideField}>
              <span>Açıklama</span>
              <input
                maxLength={180}
                required
                value={draft.description}
                onChange={(event) => updateDraft({ description: event.target.value })}
              />
            </label>

            {draft.taxType === "vat" ? (
              <fieldset className={styles.amountFields}>
                <legend>KDV mutabakatı</legend>
                <label>
                  <span>Devreden KDV alacağı</span>
                  <input
                    inputMode="decimal"
                    value={draft.carriedVatCreditAmount}
                    onChange={(event) => updateDraft({ carriedVatCreditAmount: event.target.value })}
                  />
                </label>
                <label>
                  <span>Manuel düzeltme (+ / −)</span>
                  <input
                    inputMode="decimal"
                    value={draft.manualAdjustmentAmount}
                    onChange={(event) => updateDraft({ manualAdjustmentAmount: event.target.value })}
                  />
                  <small>Pozitif tutar borcu artırır, negatif tutar azaltır.</small>
                </label>
                <div className={styles.formEstimate}>
                  <span>Kayıt sonrası tahmin</span>
                  {formVatPreview === null ? (
                    <strong>Dönem yüklenince hesaplanacak</strong>
                  ) : (
                    <strong>
                      {formatMoney(formVatPreview.payable)} ödenecek
                      {" · "}{formatMoney(formVatPreview.closingCredit)} devredecek
                    </strong>
                  )}
                </div>
              </fieldset>
            ) : (
              <label className={styles.moneyField}>
                <span>Muhasebecinin bildirdiği tutar</span>
                <input
                  inputMode="decimal"
                  required
                  value={draft.accountantAmount}
                  onChange={(event) => updateDraft({ accountantAmount: event.target.value })}
                />
              </label>
            )}

            {editingTax === null ? null : (
              <fieldset className={styles.lifecycleFields}>
                <legend>Kayıt durumu</legend>
                <label>
                  <span>Durum</span>
                  <select
                    value={draft.status}
                    onChange={(event) => updateDraft({ status: event.target.value as TaxStatus })}
                  >
                    <option value="planned">Planlandı</option>
                    <option value="paid">Ödendi</option>
                    <option value="voided">İptal</option>
                  </select>
                </label>
                {draft.status === "paid" ? (
                  <label>
                    <span>Ödeme tarihi</span>
                    <input
                      max={istanbulToday()}
                      required
                      type="date"
                      value={draft.paidOn}
                      onChange={(event) => updateDraft({ paidOn: event.target.value })}
                    />
                  </label>
                ) : null}
                {draft.status === "voided" ? (
                  <label className={styles.wideField}>
                    <span>İptal nedeni</span>
                    <input
                      minLength={3}
                      required
                      value={draft.voidReason}
                      onChange={(event) => updateDraft({ voidReason: event.target.value })}
                    />
                  </label>
                ) : null}
              </fieldset>
            )}

            <label className={styles.wideField}>
              <span>Not</span>
              <textarea
                maxLength={500}
                rows={3}
                value={draft.note}
                onChange={(event) => updateDraft({ note: event.target.value })}
              />
            </label>
            {formError === null ? null : <p className={styles.formError} role="alert">{formError}</p>}
            <div className={styles.formActions}>
              <button className={styles.primaryButton} disabled={saving} type="submit">
                {saving ? "Kaydediliyor…" : editingTax === null ? "Kaydı oluştur" : "Değişiklikleri kaydet"}
              </button>
              <button className={styles.quietButton} disabled={saving} type="button" onClick={closeEditor}>
                Vazgeç
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {loadState === "loading" ? (
        <p className={styles.message} role="status">Vergi takvimi yükleniyor…</p>
      ) : payload === null ? null : (
        <>
          <section className={styles.summary} aria-label="Vergi özeti">
            <div>
              <span>Planlanan ödeme</span>
              <strong>{formatMoney(payload.summary.plannedAmount)}</strong>
            </div>
            <div className={styles.alertSummary}>
              <span>Geciken</span>
              <strong>{formatMoney(payload.summary.overdueAmount)}</strong>
            </div>
            <div className={styles.positiveSummary}>
              <span>Ödenen</span>
              <strong>{formatMoney(payload.summary.paidAmount)}</strong>
            </div>
            <div>
              <span>Devreden KDV alacağı</span>
              <strong>{formatMoney(payload.summary.closingVatCreditAmount)}</strong>
            </div>
          </section>

          <section className={styles.vatPanel} aria-labelledby="vat-panel-title">
            <div className={styles.vatHeading}>
              <div>
                <p className={styles.kicker}>Sistem hesabı + sizin mutabakatınız</p>
                <h3 id="vat-panel-title">{formatMonth(payload.selectedPeriodMonth)} KDV görünümü</h3>
                <p>
                  Aktif dönem alacak KDV’si − aktif dönem gider KDV’si.
                  {" "}{payload.vatEstimate.sourceReceivableCount} alacak ve {payload.vatEstimate.sourceExpenseCount} gider kaydı hesaba katıldı.
                </p>
              </div>
              {canWrite ? (
                <button
                  className={styles.quietButton}
                  type="button"
                  onClick={() => vatRecord === null ? openCreate("vat") : openEdit(vatRecord)}
                >
                  {vatRecord === null ? "KDV kaydı oluştur" : "KDV kaydını düzenle"}
                </button>
              ) : null}
            </div>
            <div className={styles.vatEquation}>
              <div>
                <span>Hesaplanan satış KDV’si</span>
                <strong>{formatMoney(payload.vatEstimate.systemOutputVatAmount)}</strong>
                <small>Sistem</small>
              </div>
              <b aria-hidden="true">−</b>
              <div>
                <span>İndirilecek gider KDV’si</span>
                <strong>{formatMoney(payload.vatEstimate.systemInputVatAmount)}</strong>
                <small>Sistem</small>
              </div>
              <b aria-hidden="true">=</b>
              <div className={styles.netVat}>
                <span>Sistem net KDV</span>
                <strong>{formatSignedMoney(payload.vatEstimate.systemNetVatAmount)}</strong>
                <small>Otomatik hesap</small>
              </div>
            </div>
            {vatNeedsRefresh ? (
              <p className={styles.vatWarning} role="status">
                Kaynak kayıtlar KDV kaydından sonra değişti. Güncel sistem hesabını
                kaydetmek için KDV kaydını düzenleyin.
              </p>
            ) : null}
            {vatValues === null ? null : (
              <div className={styles.vatReconciliation}>
                <dl>
                  <div><dt>Sistem net KDV</dt><dd>{formatSignedMoney(payload.vatEstimate.systemNetVatAmount)}</dd></div>
                  <div><dt>Devreden KDV alacağı</dt><dd>− {formatMoney(vatValues.carried)}</dd></div>
                  <div><dt>Manuel düzeltme</dt><dd>{formatSignedMoney(vatValues.manual)}</dd></div>
                </dl>
                <div className={styles.vatOutcomes}>
                  <div>
                    <span>Ödenecek KDV</span>
                    <strong>{formatMoney(vatValues.payable)}</strong>
                  </div>
                  <div>
                    <span>Sonraki döneme alacak</span>
                    <strong>{formatMoney(vatValues.closingCredit)}</strong>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={styles.register} aria-labelledby="tax-register-title">
            <div className={styles.registerHeading}>
              <div>
                <p className={styles.kicker}>Vade defteri / {String(periodTaxes.length).padStart(2, "0")}</p>
                <h3 id="tax-register-title">Vergi kayıtları</h3>
              </div>
              {canWrite ? (
                <div className={styles.quickCreate}>
                  <button type="button" onClick={() => openCreate("income_tax")}>Gelir vergisi ekle</button>
                  <button type="button" onClick={() => openCreate("provisional_tax")}>Geçici vergi ekle</button>
                </div>
              ) : null}
            </div>
            {periodTaxes.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>Bu dönem için vergi kaydı yok.</strong>
                <span>KDV tahmini kayıt oluşturulmadan da yukarıda görünür.</span>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table aria-label={`${formatMonth(periodMonth)} vergi kayıtları`}>
                  <thead>
                    <tr>
                      <th scope="col">Vergi</th>
                      <th scope="col">Dönem</th>
                      <th scope="col">Vade</th>
                      <th scope="col">Tutar</th>
                      <th scope="col">Durum</th>
                      <th scope="col">Ödeme</th>
                      {canWrite ? <th scope="col">İşlem</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {periodTaxes.map((tax) => {
                      const status = statusPresentation(tax);
                      return (
                        <tr key={tax.id}>
                          <td data-label="Vergi">
                            <strong>{tax.description}</strong>
                            <small>{typeLabel(tax.taxType)}</small>
                          </td>
                          <td data-label="Dönem">{formatMonth(tax.periodMonth)}</td>
                          <td data-label="Vade">{formatDate(tax.dueOn)}</td>
                          <td data-label="Tutar">
                            <strong>{formatMoney(tax.payableAmount)}</strong>
                            {tax.taxType === "vat" && new Decimal(tax.closingVatCreditAmount).greaterThan(0) ? (
                              <small>{formatMoney(tax.closingVatCreditAmount)} alacak devri</small>
                            ) : null}
                          </td>
                          <td data-label="Durum">
                            <span className={`${styles.status} ${styles[status.className]}`}>{status.label}</span>
                          </td>
                          <td data-label="Ödeme">{formatDate(tax.paidOn)}</td>
                          {canWrite ? (
                            <td data-label="İşlem">
                              <div className={styles.rowActions}>
                                <button
                                  aria-label={`${tax.description} kaydını düzenle`}
                                  type="button"
                                  onClick={() => openEdit(tax)}
                                >
                                  Düzenle
                                </button>
                                {tax.status === "planned" ? (
                                  <button
                                    aria-label={`${tax.description} kaydını ödendi olarak işaretle`}
                                    disabled={updatingId !== null}
                                    type="button"
                                    onClick={() => void markPaid(tax)}
                                  >
                                    {updatingId === tax.id ? "İşleniyor…" : "Ödendi işaretle"}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
