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

import styles from "@/components/home/finance-accounts-workspace.module.css";
import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

type AccountType = "bank" | "cash";
type AccountStatus = "active" | "inactive";
type TransactionType = "expense" | "income" | "transfer";
type Editor = "account" | "movement" | "reverse" | null;

type AccountDto = Readonly<{
  accountType: AccountType;
  balanceAmount: string;
  bankName: string | null;
  currency: "TRY";
  displayName: string;
  id: string;
  openingBalanceAmount: string;
  status: AccountStatus;
  version: number;
}>;

type TransactionDto = Readonly<{
  amount: string;
  currency: "TRY";
  description: string;
  id: string;
  isReversal: boolean;
  occurredOn: string;
  reversed: boolean;
  sourceAccount: Readonly<{ id: string; name: string }> | null;
  targetAccount: Readonly<{ id: string; name: string }> | null;
  transactionType: TransactionType;
}>;

type OverviewDto = Readonly<{
  accounts: readonly AccountDto[];
  recentTransactions: readonly TransactionDto[];
  summary: Readonly<{
    accountCount: number;
    activeAccountCount: number;
    bankBalanceAmount: string;
    cashBalanceAmount: string;
    currency: "TRY";
    totalLiquidBalance: string;
  }>;
}>;

type AccountDraft = {
  accountType: AccountType;
  bankName: string;
  displayName: string;
  openingBalanceAmount: string;
  status: AccountStatus;
};

type MovementDraft = {
  amount: string;
  description: string;
  occurredOn: string;
  sourceAccountId: string;
  targetAccountId: string;
  transactionType: TransactionType;
};

const EMPTY_SUMMARY: OverviewDto["summary"] = {
  accountCount: 0,
  activeAccountCount: 0,
  bankBalanceAmount: "0.0000",
  cashBalanceAmount: "0.0000",
  currency: "TRY",
  totalLiquidBalance: "0.0000",
};

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

function emptyAccountDraft(): AccountDraft {
  return {
    accountType: "bank",
    bankName: "",
    displayName: "",
    openingBalanceAmount: "0",
    status: "active",
  };
}

function emptyMovementDraft(): MovementDraft {
  return {
    amount: "",
    description: "",
    occurredOn: istanbulToday(),
    sourceAccountId: "",
    targetAccountId: "",
    transactionType: "income",
  };
}

function editableMoney(value: string): string {
  const [integer, fraction = ""] = value.split(".", 2);
  const trimmed = fraction.replace(/0+$/u, "");
  return trimmed === "" ? integer : `${integer}.${trimmed}`;
}

function canonicalMoney(value: string): string {
  return value.trim().replace(",", ".");
}

function formatMoney(value: string): string {
  try {
    const [integer, fraction] = new Decimal(value).toFixed(2).split(".");
    const sign = integer.startsWith("-") ? "−" : "";
    const digits = integer.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
    return `${sign}₺${digits},${fraction}`;
  } catch {
    return "—";
  }
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

function transactionLabel(type: TransactionType): string {
  return { expense: "Gider", income: "Gelir", transfer: "Transfer" }[type];
}

function operationKey(
  holder: React.MutableRefObject<Readonly<{ fingerprint: string; key: string }> | null>,
  fingerprint: string,
): string {
  if (holder.current === null || holder.current.fingerprint !== fingerprint) {
    holder.current = { fingerprint, key: globalThis.crypto.randomUUID() };
  }
  return holder.current.key;
}

export function FinanceAccountsWorkspace({
  canWrite,
}: Readonly<{ canWrite: boolean }>) {
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [editingAccount, setEditingAccount] = useState<AccountDto | null>(null);
  const [reversing, setReversing] = useState<TransactionDto | null>(null);
  const [accountDraft, setAccountDraft] = useState<AccountDraft>(emptyAccountDraft);
  const [movementDraft, setMovementDraft] = useState<MovementDraft>(emptyMovementDraft);
  const [reversalReason, setReversalReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const accountOperation = useRef<Readonly<{ fingerprint: string; key: string }> | null>(null);
  const movementOperation = useRef<Readonly<{ fingerprint: string; key: string }> | null>(null);
  const reversalOperation = useRef<Readonly<{ fingerprint: string; key: string }> | null>(null);
  const editorTitleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/finance/accounts", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (response.status === 401) return redirectToPortalLogin();
    if (!response.ok) throw new Error("Finance accounts are unavailable.");
    const payload = (await response.json()) as Partial<OverviewDto>;
    if (
      !Array.isArray(payload.accounts) ||
      !Array.isArray(payload.recentTransactions) ||
      payload.summary === undefined
    ) {
      throw new Error("Finance account response is invalid.");
    }
    setOverview(payload as OverviewDto);
    setLoadError(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => loadOverview(controller.signal))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOverview(null);
        setLoadError(true);
      });
    return () => controller.abort();
  }, [loadOverview]);

  useEffect(() => {
    if (editor === null) return;
    const frame = requestAnimationFrame(() => editorTitleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  const accounts = useMemo(() => overview?.accounts ?? [], [overview]);
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status === "active"),
    [accounts],
  );
  const summary = overview?.summary ?? EMPTY_SUMMARY;
  const distributionTotal = useMemo(
    () =>
      accounts.reduce(
        (sum, account) => sum.plus(new Decimal(account.balanceAmount).abs()),
        new Decimal(0),
      ),
    [accounts],
  );

  function closeEditor(): void {
    const returnTarget = returnFocusRef.current;
    setEditor(null);
    setEditingAccount(null);
    setReversing(null);
    setFormError(null);
    setSaving(false);
    requestAnimationFrame(() => returnTarget?.focus());
  }

  function openAccount(account?: AccountDto, trigger?: HTMLElement): void {
    if (trigger) returnFocusRef.current = trigger;
    setEditingAccount(account ?? null);
    setAccountDraft(
      account
        ? {
            accountType: account.accountType,
            bankName: account.bankName ?? "",
            displayName: account.displayName,
            openingBalanceAmount: editableMoney(account.openingBalanceAmount),
            status: account.status,
          }
        : emptyAccountDraft(),
    );
    setFormError(null);
    setEditor("account");
    accountOperation.current = null;
  }

  function openMovement(trigger?: HTMLElement): void {
    if (trigger) returnFocusRef.current = trigger;
    const initial = emptyMovementDraft();
    initial.targetAccountId = activeAccounts[0]?.id ?? "";
    setMovementDraft(initial);
    setFormError(null);
    setEditor("movement");
    movementOperation.current = null;
  }

  function openReversal(transaction: TransactionDto, trigger?: HTMLElement): void {
    if (trigger) returnFocusRef.current = trigger;
    setReversing(transaction);
    setReversalReason("");
    setFormError(null);
    setEditor("reverse");
    reversalOperation.current = null;
  }

  async function refreshAfterMutation(
    message: string,
    operation: React.MutableRefObject<Readonly<{ fingerprint: string; key: string }> | null>,
  ): Promise<void> {
    try {
      await loadOverview();
    } catch {
      const warning =
        "Kayıt oluştu, görünüm yenilenemedi. Aynı işlemle güvenle yeniden deneyebilirsiniz.";
      setAnnouncement(warning);
      setFormError(warning);
      setSaving(false);
      return;
    }
    operation.current = null;
    setAnnouncement(message);
    closeEditor();
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const displayName = accountDraft.displayName.trim();
    if (displayName === "") {
      setFormError("Hesap adı zorunludur.");
      return;
    }
    const base = {
      accountType: accountDraft.accountType,
      bankName:
        accountDraft.accountType === "bank"
          ? accountDraft.bankName.trim() || null
          : null,
      displayName,
      status: accountDraft.status,
    };
    const fingerprint = JSON.stringify({
      ...base,
      openingBalanceAmount: canonicalMoney(accountDraft.openingBalanceAmount),
    });
    const body = editingAccount
      ? { ...base, version: editingAccount.version }
      : {
          ...base,
          clientOperationKey: operationKey(accountOperation, fingerprint),
          openingBalanceAmount: canonicalMoney(accountDraft.openingBalanceAmount),
        };
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(
        editingAccount
          ? `/api/finance/accounts/${editingAccount.id}`
          : "/api/finance/accounts",
        {
          body: JSON.stringify(body),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: editingAccount ? "PATCH" : "POST",
        },
      );
      if (response.status === 401) return redirectToPortalLogin();
      const payload = (await response.json()) as { account?: AccountDto; status?: string };
      if (!response.ok || payload.account === undefined) {
        setFormError(
          payload.status === "version_conflict"
            ? "Hesap başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin."
            : payload.status === "validation_error"
              ? "Hesap adı, türü ve açılış bakiyesini kontrol edin."
              : "Hesap kaydedilemedi. Lütfen yeniden deneyin.",
        );
        setSaving(false);
        return;
      }
      await refreshAfterMutation(
        `${payload.account.displayName} hesabı kaydedildi.`,
        accountOperation,
      );
    } catch {
      setFormError("Hesap kaydedilemedi. Bağlantıyı kontrol edin.");
      setSaving(false);
    }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const draft = movementDraft;
    const sourceAccountId =
      draft.transactionType === "income" ? null : draft.sourceAccountId || null;
    const targetAccountId =
      draft.transactionType === "expense" ? null : draft.targetAccountId || null;
    if (
      draft.description.trim() === "" ||
      canonicalMoney(draft.amount) === "" ||
      (draft.transactionType !== "income" && sourceAccountId === null) ||
      (draft.transactionType !== "expense" && targetAccountId === null) ||
      (draft.transactionType === "transfer" && sourceAccountId === targetAccountId)
    ) {
      setFormError("Hareket türü, hesaplar, açıklama ve tutar alanlarını kontrol edin.");
      return;
    }
    const base = {
      amount: canonicalMoney(draft.amount),
      description: draft.description.trim(),
      occurredOn: draft.occurredOn,
      sourceAccountId,
      targetAccountId,
      transactionType: draft.transactionType,
    };
    const body = {
      ...base,
      clientOperationKey: operationKey(movementOperation, JSON.stringify(base)),
    };
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/finance/account-transactions", {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status === 401) return redirectToPortalLogin();
      const payload = (await response.json()) as {
        status?: string;
        transaction?: TransactionDto;
      };
      if (!response.ok || payload.transaction === undefined) {
        const message = {
          account_inactive: "Pasif hesaba yeni hareket kaydedilemez.",
          future_date: "İleri tarihli hareket kaydedilemez.",
          validation_error: "Hareket bilgilerini ve tutarı kontrol edin.",
        }[payload.status ?? ""];
        setFormError(message ?? "Hareket kaydedilemedi. Lütfen yeniden deneyin.");
        setSaving(false);
        return;
      }
      await refreshAfterMutation(
        `${payload.transaction.description} hareketi kaydedildi.`,
        movementOperation,
      );
    } catch {
      setFormError("Hareket kaydedilemedi. Bağlantıyı kontrol edin.");
      setSaving(false);
    }
  }

  async function submitReversal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!reversing || reversalReason.trim().length < 3) {
      setFormError("Ters kayıt için en az 3 karakterlik gerekçe girin.");
      return;
    }
    const base = { id: reversing.id, reason: reversalReason.trim() };
    const body = {
      clientOperationKey: operationKey(reversalOperation, JSON.stringify(base)),
      reason: base.reason,
    };
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(
        `/api/finance/account-transactions/${reversing.id}/reverse`,
        {
          body: JSON.stringify(body),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (response.status === 401) return redirectToPortalLogin();
      const payload = (await response.json()) as {
        status?: string;
        transaction?: TransactionDto;
      };
      if (!response.ok || payload.transaction === undefined) {
        setFormError(
          payload.status === "already_reversed"
            ? "Bu hareket daha önce ters kayıtla kapatıldı."
            : "Ters kayıt oluşturulamadı. Listeyi yenileyip tekrar deneyin.",
        );
        setSaving(false);
        return;
      }
      await refreshAfterMutation(
        "Ters kayıt oluşturuldu; önceki hareket silinmeden dengelendi.",
        reversalOperation,
      );
    } catch {
      setFormError("Ters kayıt oluşturulamadı. Bağlantıyı kontrol edin.");
      setSaving(false);
    }
  }

  return (
    <section className={styles.workspace} aria-labelledby="account-ledger-title">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <header className={styles.commandBar}>
        <div>
          <p className="section-kicker">Finans / Likit varlıklar</p>
          <h2 id="account-ledger-title">Kasa ve banka hesapları</h2>
          <p>Bakiyeler açılış değeri ve değiştirilemeyen defter hareketlerinden türetilir.</p>
        </div>
        {canWrite ? (
          <div className={styles.actions}>
            <button
              aria-expanded={editor === "account"}
              className="text-action"
              type="button"
              onClick={(event) => openAccount(undefined, event.currentTarget)}
            >
              Hesap ekle
            </button>
            <button
              className="primary-action"
              disabled={activeAccounts.length === 0}
              type="button"
              onClick={(event) => openMovement(event.currentTarget)}
            >
              + Hareket kaydet
            </button>
          </div>
        ) : null}
      </header>

      <section className={styles.summary} aria-label="Likit varlık özeti">
        <article className={styles.totalCard}>
          <span>Toplam likit varlık</span>
          <strong>{overview ? formatMoney(summary.totalLiquidBalance) : "—"}</strong>
          <small>{summary.activeAccountCount} aktif / {summary.accountCount} hesap</small>
        </article>
        <article>
          <span>Banka toplamı</span>
          <strong>{overview ? formatMoney(summary.bankBalanceAmount) : "—"}</strong>
          <small>Vadesiz ve işletme hesapları</small>
        </article>
        <article>
          <span>Kasa toplamı</span>
          <strong>{overview ? formatMoney(summary.cashBalanceAmount) : "—"}</strong>
          <small>Fiziksel ve operasyonel kasa</small>
        </article>
      </section>

      {editor === "account" ? (
        <section className={styles.editor} aria-labelledby="account-editor-title">
          <div>
            <p className="section-kicker">{editingAccount ? "Hesap düzenle" : "Yeni hesap"}</p>
            <h3 id="account-editor-title" ref={editorTitleRef} tabIndex={-1}>
              {editingAccount ? editingAccount.displayName : "Hesap tanımla"}
            </h3>
            <p>
              Açılış bakiyesi yalnız kuruluşta belirlenir. Sonraki farklar hareket veya
              ters kayıt olarak işlenir.
            </p>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitAccount(event)}>
            <label>
              <span>Hesap türü</span>
              <select
                value={accountDraft.accountType}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    accountType: event.target.value as AccountType,
                    bankName: event.target.value === "cash" ? "" : current.bankName,
                  }))
                }
              >
                <option value="bank">Banka hesabı</option>
                <option value="cash">Kasa</option>
              </select>
            </label>
            <label>
              <span>Hesap adı</span>
              <input
                maxLength={191}
                required
                value={accountDraft.displayName}
                onChange={(event) =>
                  setAccountDraft((current) => ({ ...current, displayName: event.target.value }))
                }
              />
            </label>
            {accountDraft.accountType === "bank" ? (
              <label>
                <span>Banka adı <small>(isteğe bağlı)</small></span>
                <input
                  maxLength={191}
                  value={accountDraft.bankName}
                  onChange={(event) =>
                    setAccountDraft((current) => ({ ...current, bankName: event.target.value }))
                  }
                />
              </label>
            ) : null}
            <label>
              <span>Açılış bakiyesi (₺)</span>
              <input
                disabled={editingAccount !== null}
                inputMode="decimal"
                required
                value={accountDraft.openingBalanceAmount}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    openingBalanceAmount: event.target.value,
                  }))
                }
              />
            </label>
            {editingAccount ? (
              <label>
                <span>Durum</span>
                <select
                  value={accountDraft.status}
                  onChange={(event) =>
                    setAccountDraft((current) => ({
                      ...current,
                      status: event.target.value as AccountStatus,
                    }))
                  }
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Pasif</option>
                </select>
              </label>
            ) : null}
            {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
            <div className={styles.formActions}>
              <button className="text-action" disabled={saving} type="button" onClick={closeEditor}>
                Vazgeç
              </button>
              <button className="primary-action" disabled={saving} type="submit">
                {saving ? "Kaydediliyor…" : "Hesabı kaydet"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {editor === "movement" ? (
        <section className={styles.editor} aria-labelledby="movement-editor-title">
          <div>
            <p className="section-kicker">Yeni defter hareketi</p>
            <h3 id="movement-editor-title" ref={editorTitleRef} tabIndex={-1}>Gelir, gider veya transfer</h3>
            <p>Transfer tek işlemde iki hesap bacağı oluşturur; toplam varlığı iki kez saymaz.</p>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitMovement(event)}>
            <label>
              <span>Hareket türü</span>
              <select
                value={movementDraft.transactionType}
                onChange={(event) => {
                  const transactionType = event.target.value as TransactionType;
                  setMovementDraft((current) => ({
                    ...current,
                    sourceAccountId:
                      transactionType === "income" ? "" : current.sourceAccountId || activeAccounts[0]?.id || "",
                    targetAccountId:
                      transactionType === "expense" ? "" : current.targetAccountId || activeAccounts[0]?.id || "",
                    transactionType,
                  }));
                }}
              >
                <option value="income">Gelir</option>
                <option value="expense">Gider</option>
                <option value="transfer">Hesaplar arası transfer</option>
              </select>
            </label>
            {movementDraft.transactionType !== "income" ? (
              <label>
                <span>Kaynak hesap</span>
                <select
                  required
                  value={movementDraft.sourceAccountId}
                  onChange={(event) =>
                    setMovementDraft((current) => ({ ...current, sourceAccountId: event.target.value }))
                  }
                >
                  <option value="">Hesap seçin</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.displayName}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {movementDraft.transactionType !== "expense" ? (
              <label>
                <span>Hedef hesap</span>
                <select
                  required
                  value={movementDraft.targetAccountId}
                  onChange={(event) =>
                    setMovementDraft((current) => ({ ...current, targetAccountId: event.target.value }))
                  }
                >
                  <option value="">Hesap seçin</option>
                  {activeAccounts
                    .filter((account) => account.id !== movementDraft.sourceAccountId)
                    .map((account) => (
                      <option key={account.id} value={account.id}>{account.displayName}</option>
                    ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>Tarih</span>
              <input
                max={istanbulToday()}
                min="1000-01-01"
                required
                type="date"
                value={movementDraft.occurredOn}
                onChange={(event) =>
                  setMovementDraft((current) => ({ ...current, occurredOn: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Tutar (₺)</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                required
                value={movementDraft.amount}
                onChange={(event) =>
                  setMovementDraft((current) => ({ ...current, amount: event.target.value }))
                }
              />
            </label>
            <label className={styles.wide}>
              <span>Açıklama</span>
              <input
                maxLength={191}
                required
                value={movementDraft.description}
                onChange={(event) =>
                  setMovementDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
            <div className={styles.formActions}>
              <button className="text-action" disabled={saving} type="button" onClick={closeEditor}>Vazgeç</button>
              <button className="primary-action" disabled={saving} type="submit">
                {saving ? "Kaydediliyor…" : "Hareketi kaydet"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {editor === "reverse" && reversing ? (
        <section className={styles.editor} aria-labelledby="reverse-editor-title">
          <div>
            <p className="section-kicker">Kontrollü düzeltme</p>
            <h3 id="reverse-editor-title" ref={editorTitleRef} tabIndex={-1}>Ters kayıt oluştur</h3>
            <p>
              “{reversing.description}” silinmez; aynı tutarda karşı hareket ve denetim izi oluşturulur.
            </p>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitReversal(event)}>
            <label className={styles.wide}>
              <span>Düzeltme gerekçesi</span>
              <textarea
                maxLength={2000}
                minLength={3}
                required
                rows={3}
                value={reversalReason}
                onChange={(event) => setReversalReason(event.target.value)}
              />
            </label>
            {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
            <div className={styles.formActions}>
              <button className="text-action" disabled={saving} type="button" onClick={closeEditor}>Vazgeç</button>
              <button className={styles.dangerAction} disabled={saving} type="submit">
                {saving ? "Oluşturuluyor…" : "Ters kaydı oluştur"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {loadError ? (
        <div className={styles.message} role="alert">
          <span>Hesaplara ulaşılamadı. Bağlantıyı kontrol edin.</span>
          <button type="button" onClick={() => void loadOverview()}>Yeniden dene</button>
        </div>
      ) : null}

      <div className={styles.contentGrid}>
        <section className={styles.accountPanel} aria-labelledby="account-list-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className="section-kicker">Hesap görünümü</p>
              <h3 id="account-list-title">Varlık dağılımı</h3>
            </div>
            <span>{accounts.length} hesap</span>
          </div>
          <div className={styles.accountList}>
            {accounts.map((account) => {
              const share = distributionTotal.isZero()
                ? 0
                : Decimal.min(
                    100,
                    new Decimal(account.balanceAmount)
                      .abs()
                      .div(distributionTotal)
                      .times(100),
                  ).toNumber();
              return (
                <article
                  className={`${styles.accountCard} ${account.status === "inactive" ? styles.inactive : ""}`}
                  key={account.id}
                >
                  <div className={styles.accountCardTop}>
                    <span className={styles.accountType}>
                      {account.accountType === "bank" ? "Banka" : "Kasa"}
                    </span>
                    <span>{account.status === "active" ? "Aktif" : "Pasif"}</span>
                  </div>
                  <h4>{account.displayName}</h4>
                  <p>{account.bankName ?? (account.accountType === "cash" ? "Operasyon kasası" : "Banka adı belirtilmedi")}</p>
                  <strong>{formatMoney(account.balanceAmount)}</strong>
                  <div className={styles.shareTrack} aria-label={`Dağılım payı yüzde ${share.toFixed(0)}`}>
                    <span style={{ width: `${share}%` }} />
                  </div>
                  <footer>
                    <small>Açılış {formatMoney(account.openingBalanceAmount)}</small>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={(event) => openAccount(account, event.currentTarget)}
                      >
                        Düzenle
                      </button>
                    ) : null}
                  </footer>
                </article>
              );
            })}
            {!loadError && accounts.length === 0 ? (
              <p className={styles.empty}>
                {overview ? "Henüz kasa veya banka hesabı tanımlanmadı." : "Hesaplar yükleniyor…"}
              </p>
            ) : null}
          </div>
        </section>

        <section className={styles.movementPanel} aria-labelledby="recent-movements-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className="section-kicker">Defter izi</p>
              <h3 id="recent-movements-title">Son hareketler</h3>
            </div>
            <span>Son 12</span>
          </div>
          <div className={styles.movementList}>
            {(overview?.recentTransactions ?? []).map((transaction) => (
              <article className={styles.movement} key={transaction.id}>
                <span className={`${styles.movementIcon} ${styles[transaction.transactionType]}`} aria-hidden="true">
                  {transaction.transactionType === "income" ? "↓" : transaction.transactionType === "expense" ? "↑" : "↔"}
                </span>
                <div>
                  <div className={styles.movementTitle}>
                    <strong>{transaction.description}</strong>
                    <span>{transactionLabel(transaction.transactionType)}</span>
                  </div>
                  <p>
                    {transaction.sourceAccount?.name ?? "Dış kaynak"}
                    <span aria-hidden="true"> → </span>
                    {transaction.targetAccount?.name ?? "Dış ödeme"}
                  </p>
                  <small>
                    {formatDate(transaction.occurredOn)}
                    {transaction.isReversal ? " · Ters kayıt" : ""}
                    {transaction.reversed ? " · Ters kayıtla kapatıldı" : ""}
                  </small>
                </div>
                <div className={styles.movementAmount}>
                  <strong>{formatMoney(transaction.amount)}</strong>
                  {canWrite && !transaction.isReversal && !transaction.reversed ? (
                    <button
                      type="button"
                      onClick={(event) => openReversal(transaction, event.currentTarget)}
                    >
                      Ters kayıt
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {!loadError && (overview?.recentTransactions.length ?? 0) === 0 ? (
              <p className={styles.empty}>
                {overview ? "Henüz hesap hareketi yok." : "Hareketler yükleniyor…"}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
