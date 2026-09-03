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

type LoadState = "error" | "loading" | "ready";
type SaveState = "idle" | "saving";
type CardStatus = "active" | "inactive";
type InstallmentStatus = "overdue" | "paid" | "planned";

type CreditCardDto = Readonly<{
  bankName: string | null;
  createdAtUtc?: string;
  creditLimitAmount: string | null;
  displayName: string;
  id: string;
  lastFour: string | null;
  note: string | null;
  paymentDueDay: number;
  statementClosingDay: number;
  status: CardStatus;
  updatedAtUtc?: string;
  version: number;
}>;

type CardInstallmentDto = Readonly<{
  amount: string;
  creditCardId: string;
  creditCardName: string;
  expenseDescription: string;
  dueOn: string;
  expenseId: string;
  id: string;
  installmentCount: number;
  installmentNumber: number;
  paidOn: string | null;
  statementMonth: string;
  status: InstallmentStatus;
  version: number;
}>;

type CardDraft = {
  bankName: string;
  creditLimitAmount: string;
  displayName: string;
  lastFour: string;
  note: string;
  paymentDueDay: string;
  statementClosingDay: string;
  status: CardStatus;
};

type PaymentDraft = Readonly<{
  installmentId: string;
  paidOn: string;
}>;

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

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function formatMoney(value: string): string {
  try {
    const [integer, fraction] = new Decimal(value).toFixed(4).split(".");
    const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
    const visibleFraction = fraction.replace(/0+$/u, "").padEnd(2, "0");
    return `₺${groupedInteger},${visibleFraction}`;
  } catch {
    return "—";
  }
}

function sumMoney(values: readonly string[]): string {
  return values
    .reduce((sum, value) => sum.plus(value), new Decimal(0))
    .toFixed(4);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function emptyDraft(): CardDraft {
  return {
    bankName: "",
    creditLimitAmount: "",
    displayName: "",
    lastFour: "",
    note: "",
    paymentDueDay: "20",
    statementClosingDay: "10",
    status: "active",
  };
}

function draftFromCard(card: CreditCardDto): CardDraft {
  return {
    bankName: card.bankName ?? "",
    creditLimitAmount: card.creditLimitAmount?.replace(/\.0+$/u, "") ?? "",
    displayName: card.displayName,
    lastFour: card.lastFour ?? "",
    note: card.note ?? "",
    paymentDueDay: String(card.paymentDueDay),
    statementClosingDay: String(card.statementClosingDay),
    status: card.status,
  };
}

function cardBody(draft: CardDraft) {
  return {
    bankName: nullable(draft.bankName),
    creditLimitAmount: nullable(draft.creditLimitAmount.replace(",", ".")),
    displayName: draft.displayName.trim(),
    lastFour: nullable(draft.lastFour),
    note: nullable(draft.note),
    paymentDueDay: Number(draft.paymentDueDay),
    statementClosingDay: Number(draft.statementClosingDay),
    status: draft.status,
  };
}

function statusLabel(status: InstallmentStatus): string {
  return {
    overdue: "Gecikti",
    paid: "Ödendi",
    planned: "Planlandı",
  }[status];
}

function withCurrentStatus(installment: CardInstallmentDto): CardInstallmentDto {
  if (installment.status !== "planned" || installment.dueOn >= istanbulToday()) {
    return installment;
  }
  return { ...installment, status: "overdue" };
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

export function CardPlanWorkspace() {
  const [cards, setCards] = useState<readonly CreditCardDto[]>([]);
  const [installments, setInstallments] = useState<readonly CardInstallmentDto[]>([]);
  const [cardLoadState, setCardLoadState] = useState<LoadState>("loading");
  const [planLoadState, setPlanLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const [planRequestRevision, setPlanRequestRevision] = useState(0);
  const [month, setMonth] = useState(currentIstanbulMonth());
  const [cardFilter, setCardFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCardDto | null>(null);
  const [draft, setDraft] = useState<CardDraft>(() => emptyDraft());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [cardActionError, setCardActionError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [updatingInstallmentId, setUpdatingInstallmentId] = useState<string | null>(null);
  const [updatingCardId, setUpdatingCardId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const editorTitleRef = useRef<HTMLHeadingElement>(null);
  const operationRef = useRef<Readonly<{ fingerprint: string; key: string }> | null>(
    null,
  );

  const loadCards = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/finance/cards", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (response.status === 401) return redirectToLogin();
    if (!response.ok) throw new Error("Cards are unavailable.");
    const payload = (await response.json()) as { cards?: CreditCardDto[] };
    if (!Array.isArray(payload.cards)) throw new Error("Card response is invalid.");
    setCards(payload.cards);
    setCardLoadState("ready");
  }, []);

  const loadInstallments = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (month !== "") query.set("month", month);
      if (cardFilter !== "all") query.set("cardId", cardFilter);
      const queryString = query.toString();
      const response = await fetch(`/api/finance/card-installments${queryString === "" ? "" : `?${queryString}`}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      if (response.status === 401) return redirectToLogin();
      if (!response.ok) throw new Error("Installments are unavailable.");
      const payload = (await response.json()) as {
        installments?: CardInstallmentDto[];
      };
      if (!Array.isArray(payload.installments)) {
        throw new Error("Installment response is invalid.");
      }
      setInstallments(payload.installments);
      setPlanError(null);
      setPlanLoadState("ready");
    },
    [cardFilter, month],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => loadCards(controller.signal))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCards([]);
        setInstallments([]);
        setCardLoadState("error");
        setPlanLoadState("error");
        setPlanError(null);
      });
    return () => controller.abort();
  }, [loadCards, requestRevision]);

  useEffect(() => {
    if (cardLoadState !== "ready") return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => loadInstallments(controller.signal))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setInstallments([]);
        setPlanError("Ödeme planına ulaşılamadı. Bağlantıyı kontrol edin.");
        setPlanLoadState("error");
      });
    return () => controller.abort();
  }, [cardLoadState, loadInstallments, planRequestRevision]);

  useEffect(() => {
    if (!editorOpen) return;
    const title = editorTitleRef.current;
    title?.scrollIntoView?.({ block: "start" });
    title?.focus({ preventScroll: true });
  }, [editorOpen, editingCard]);

  const summary = useMemo(
    () => ({
      overdue: sumMoney(
        installments
          .filter((installment) => installment.status === "overdue")
          .map((installment) => installment.amount),
      ),
      paid: sumMoney(
        installments
          .filter((installment) => installment.status === "paid")
          .map((installment) => installment.amount),
      ),
      planned: sumMoney(
        installments
          .filter((installment) => installment.status !== "paid")
          .map((installment) => installment.amount),
      ),
      total: sumMoney(installments.map((installment) => installment.amount)),
    }),
    [installments],
  );

  function updateDraft(next: Partial<CardDraft>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function openCreate(): void {
    setDraft(emptyDraft());
    setEditingCard(null);
    setEditorOpen(true);
    setFormError(null);
    operationRef.current = null;
  }

  function openEdit(card: CreditCardDto): void {
    setDraft(draftFromCard(card));
    setEditingCard(card);
    setEditorOpen(true);
    setFormError(null);
    operationRef.current = null;
  }

  function closeEditor(): void {
    setEditorOpen(false);
    setEditingCard(null);
    setSaveState("idle");
    setFormError(null);
    operationRef.current = null;
  }

  async function submitCard(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const body = cardBody(draft);
    if (body.displayName === "") {
      setFormError("Kart adı zorunludur.");
      return;
    }
    if (body.lastFour !== null && !/^\d{4}$/u.test(body.lastFour)) {
      setFormError("Son dört hane yalnız dört rakam olmalıdır.");
      return;
    }
    const existing = editingCard;
    setSaveState("saving");
    setFormError(null);
    const fingerprint = JSON.stringify(body);
    if (
      existing === null &&
      (operationRef.current === null || operationRef.current.fingerprint !== fingerprint)
    ) {
      operationRef.current = { fingerprint, key: globalThis.crypto.randomUUID() };
    }
    try {
      const response = await fetch(
        existing === null ? "/api/finance/cards" : `/api/finance/cards/${existing.id}`,
        {
          body: JSON.stringify(
            existing === null
              ? { ...body, clientOperationKey: operationRef.current?.key }
              : { ...body, version: existing.version },
          ),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: existing === null ? "POST" : "PATCH",
        },
      );
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as { card?: CreditCardDto; status?: string };
      if (!response.ok || payload.card === undefined) {
        setFormError(
          response.status === 409
            ? "Kart başka bir işlemde değişti. Listeyi yenileyip yeniden deneyin."
            : payload.status === "validation_error"
              ? "Kart adı, günler, limit ve son dört hane alanlarını kontrol edin."
              : "Kart kaydedilemedi. Lütfen yeniden deneyin.",
        );
        setSaveState("idle");
        return;
      }
      const saved = payload.card;
      setCards((current) =>
        existing === null
          ? [...current, saved]
          : current.map((card) => (card.id === saved.id ? saved : card)),
      );
      setAnnouncement(
        existing === null
          ? `${saved.displayName} kartı eklendi.`
          : `${saved.displayName} kartı güncellendi.`,
      );
      operationRef.current = null;
      closeEditor();
    } catch {
      setFormError("Kart kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState("idle");
    }
  }

  async function inactivateCard(card: CreditCardDto): Promise<void> {
    if (card.status === "inactive" || updatingCardId !== null) return;
    setUpdatingCardId(card.id);
    setCardActionError(null);
    try {
      const response = await fetch(`/api/finance/cards/${card.id}`, {
        body: JSON.stringify({
          bankName: card.bankName,
          creditLimitAmount: card.creditLimitAmount,
          displayName: card.displayName,
          lastFour: card.lastFour,
          note: card.note,
          paymentDueDay: card.paymentDueDay,
          statementClosingDay: card.statementClosingDay,
          status: "inactive",
          version: card.version,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as { card?: CreditCardDto };
      if (!response.ok || payload.card === undefined) throw new Error();
      setCards((current) =>
        current.map((item) => (item.id === payload.card?.id ? payload.card : item)),
      );
      setAnnouncement(`${card.displayName} kartı pasife alındı.`);
    } catch {
      setCardActionError(`${card.displayName} kartı pasife alınamadı. Yeniden deneyin.`);
    } finally {
      setUpdatingCardId(null);
    }
  }

  async function updateInstallment(
    installment: CardInstallmentDto,
    status: "paid" | "planned",
    paidOn: string | null,
  ): Promise<void> {
    if (updatingInstallmentId !== null) return;
    setUpdatingInstallmentId(installment.id);
    setPlanError(null);
    try {
      const response = await fetch(`/api/finance/card-installments/${installment.id}`, {
        body: JSON.stringify({
          paidOn,
          status,
          version: installment.version,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        installment?: CardInstallmentDto;
      };
      if (!response.ok || payload.installment === undefined) throw new Error();
      const saved = withCurrentStatus(payload.installment);
      setInstallments((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setPaymentDraft(null);
      setAnnouncement(
        status === "paid"
          ? `${saved.expenseDescription} taksiti ödendi olarak işaretlendi.`
          : `${saved.expenseDescription} taksiti ödeme planına geri alındı.`,
      );
    } catch {
      setPlanError("Taksit durumu güncellenemedi. Listeyi yenileyip yeniden deneyin.");
    } finally {
      setUpdatingInstallmentId(null);
    }
  }

  function beginPayment(installment: CardInstallmentDto): void {
    setPaymentDraft({ installmentId: installment.id, paidOn: istanbulToday() });
    setPlanError(null);
  }

  function retryPlan(): void {
    setInstallments([]);
    setPlanError(null);
    setPlanLoadState("loading");
    setPlanRequestRevision((current) => current + 1);
  }

  return (
    <section className="card-plan-workspace" aria-labelledby="card-plan-title">
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <div className="expense-command-bar card-command-bar">
        <div>
          <p className="section-kicker">Finans / Kart defteri</p>
          <h2 id="card-plan-title">Kartlar ve ödeme planı</h2>
          <p>Kartla yapılan giderlerin taksitlerini ve yaklaşan ödeme tarihlerini izleyin.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>+ Kart ekle</button>
      </div>

      {editorOpen ? (
        <section className="finance-entry card-entry" aria-labelledby="card-form-title">
          <div className="finance-entry-intro">
            <p className="section-kicker">Kart tanımı</p>
            <h3 id="card-form-title" ref={editorTitleRef} tabIndex={-1}>
              {editingCard === null ? "Kart ekle" : "Kartı düzenle"}
            </h3>
            <p>Güvenlik için tam kart numarası ve CVV bilgisi hiçbir zaman istenmez.</p>
          </div>
          <form className="finance-form card-form" onSubmit={(event) => void submitCard(event)}>
            <label>
              <span>Kart adı</span>
              <input
                maxLength={191}
                placeholder="Örn. İş Bankası şirket kartı"
                required
                value={draft.displayName}
                onChange={(event) => updateDraft({ displayName: event.target.value })}
              />
            </label>
            <label>
              <span>Banka</span>
              <input
                maxLength={191}
                placeholder="İsteğe bağlı"
                value={draft.bankName}
                onChange={(event) => updateDraft({ bankName: event.target.value })}
              />
            </label>
            <label>
              <span>Son dört hane</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                placeholder="1234"
                value={draft.lastFour}
                onChange={(event) => updateDraft({ lastFour: event.target.value })}
              />
            </label>
            <label>
              <span>Kart limiti (₺)</span>
              <input
                inputMode="decimal"
                placeholder="İsteğe bağlı"
                value={draft.creditLimitAmount}
                onChange={(event) => updateDraft({ creditLimitAmount: event.target.value })}
              />
            </label>
            <label>
              <span>Hesap kesim günü</span>
              <input
                max={31}
                min={1}
                required
                type="number"
                value={draft.statementClosingDay}
                onChange={(event) => updateDraft({ statementClosingDay: event.target.value })}
              />
            </label>
            <label>
              <span>Son ödeme günü</span>
              <input
                max={31}
                min={1}
                required
                type="number"
                value={draft.paymentDueDay}
                onChange={(event) => updateDraft({ paymentDueDay: event.target.value })}
              />
            </label>
            <label>
              <span>Durum</span>
              <select
                value={draft.status}
                onChange={(event) => updateDraft({ status: event.target.value as CardStatus })}
              >
                <option value="active">Aktif</option>
                <option value="inactive">Pasif</option>
              </select>
            </label>
            <label className="finance-form-wide">
              <span>İç not</span>
              <textarea
                maxLength={2000}
                placeholder="İsteğe bağlı"
                rows={2}
                value={draft.note}
                onChange={(event) => updateDraft({ note: event.target.value })}
              />
            </label>
            {formError === null ? null : <p className="entry-error" role="alert">{formError}</p>}
            <div className="finance-form-actions">
              <button className="text-action" disabled={saveState === "saving"} type="button" onClick={closeEditor}>Vazgeç</button>
              <button className="primary-action" disabled={saveState === "saving"} type="submit">
                {saveState === "saving" ? "Kaydediliyor…" : "Kartı kaydet"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {cardLoadState === "error" ? (
        <div className="finance-workspace-message is-error" role="alert">
          <span>Kart kayıtlarına ulaşılamadı.</span>
          <button
            type="button"
            onClick={() => {
              setCards([]);
              setInstallments([]);
              setCardActionError(null);
              setPlanError(null);
              setCardLoadState("loading");
              setPlanLoadState("loading");
              setRequestRevision((current) => current + 1);
            }}
          >
            Yeniden dene
          </button>
        </div>
      ) : null}

      <section className="card-register" aria-labelledby="card-register-title">
        <div className="card-register-heading">
          <div>
            <p className="section-kicker">Kayıt / {String(cards.length).padStart(2, "0")}</p>
            <h3 id="card-register-title">Kart defteri</h3>
          </div>
          <p>Yalnız kart adı, banka ve son dört hane saklanır.</p>
        </div>
        {cardActionError === null ? null : (
          <p className="finance-workspace-message is-error" role="alert">
            {cardActionError}
          </p>
        )}
        {cardLoadState === "loading" ? (
          <p className="finance-workspace-message" role="status">Kartlar yükleniyor…</p>
        ) : cards.length === 0 ? (
          <div className="card-register-empty">
            <strong>Henüz kart tanımlanmadı.</strong>
            <button className="text-action" type="button" onClick={openCreate}>İlk kartı ekle</button>
          </div>
        ) : (
          <ul className="card-register-list">
            {cards.map((card) => (
              <li key={card.id}>
                <div className="card-register-identity">
                  <span aria-hidden="true">{card.lastFour === null ? "••••" : `•••• ${card.lastFour}`}</span>
                  <div>
                    <strong>{card.displayName}</strong>
                    <small>{card.bankName ?? "Banka belirtilmedi"}</small>
                  </div>
                </div>
                <dl>
                  <div><dt>Hesap kesim</dt><dd>Ayın {card.statementClosingDay}. günü</dd></div>
                  <div><dt>Son ödeme</dt><dd>Ayın {card.paymentDueDay}. günü</dd></div>
                  <div><dt>Limit</dt><dd>{card.creditLimitAmount === null ? "Belirtilmedi" : formatMoney(card.creditLimitAmount)}</dd></div>
                </dl>
                <span className={`card-register-status is-${card.status}`}>
                  {card.status === "active" ? "Aktif" : "Pasif"}
                </span>
                <div className="card-register-actions">
                  <button
                    aria-label={`${card.displayName} kartını düzenle`}
                    type="button"
                    onClick={() => openEdit(card)}
                  >
                    Düzenle
                  </button>
                  {card.status === "active" ? (
                    <button
                      aria-label={`${card.displayName} kartını pasife al`}
                      disabled={updatingCardId !== null}
                      type="button"
                      onClick={() => void inactivateCard(card)}
                    >
                      {updatingCardId === card.id ? "İşleniyor…" : "Pasife al"}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-payment-plan" aria-labelledby="payment-plan-title">
        <div className="card-plan-heading">
          <div>
            <p className="section-kicker">Aylık nakit planı</p>
            <h3 id="payment-plan-title">
              {month === "" ? "Tüm dönemler" : `${formatMonth(month)} ödeme planı`}
            </h3>
          </div>
          <div className="card-plan-filters">
            <label>
              <span>Dönem</span>
              <input
                aria-label="Ödeme planı dönemi"
                type="month"
                value={month}
                onChange={(event) => {
                  setInstallments([]);
                  setPaymentDraft(null);
                  setPlanError(null);
                  setPlanLoadState("loading");
                  setMonth(event.target.value);
                }}
              />
            </label>
            <label>
              <span>Kart</span>
              <select
                aria-label="Ödeme planı kart filtresi"
                value={cardFilter}
                onChange={(event) => {
                  setInstallments([]);
                  setPaymentDraft(null);
                  setPlanError(null);
                  setPlanLoadState("loading");
                  setCardFilter(event.target.value);
                }}
              >
                <option value="all">Tüm kartlar</option>
                {cards.map((card) => <option key={card.id} value={card.id}>{card.displayName}</option>)}
              </select>
            </label>
          </div>
        </div>

        <section className="finance-summary card-plan-summary" aria-label="Kart ödeme özeti">
          {[
            ["Dönem toplamı", summary.total],
            ["Ödenecek", summary.planned],
            ["Geciken", summary.overdue],
            ["Ödendi", summary.paid],
          ].map(([label, value]) => (
            <div className={label === "Geciken" ? "is-attention" : label === "Ödendi" ? "is-positive" : undefined} key={label}>
              <span>{label}</span>
              <strong>{planLoadState === "ready" ? formatMoney(value) : "—"}</strong>
            </div>
          ))}
        </section>

        {planError === null ? null : (
          <div className="finance-workspace-message is-error" role="alert">
            <span>{planError}</span>
            {planLoadState === "error" ? (
              <button type="button" onClick={retryPlan}>Yeniden dene</button>
            ) : null}
          </div>
        )}

        {planLoadState === "error" ? null : <div className="finance-table-wrap card-plan-table-wrap">
          <table className="finance-table card-plan-table" aria-label="Kart taksit ve ödeme planı">
            <thead>
              <tr>
                <th scope="col">Kart</th>
                <th scope="col">Gider</th>
                <th scope="col">Taksit</th>
                <th scope="col">Son ödeme</th>
                <th scope="col">Tutar</th>
                <th scope="col">Durum</th>
                <th scope="col">Ödeme tarihi</th>
                <th scope="col">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((installment) => (
                <tr key={installment.id}>
                  <td data-label="Kart"><strong>{installment.creditCardName}</strong></td>
                  <td data-label="Gider">{installment.expenseDescription}</td>
                  <td data-label="Taksit">{installment.installmentNumber} / {installment.installmentCount}</td>
                  <td data-label="Son ödeme">{formatDate(installment.dueOn)}</td>
                  <td data-label="Tutar"><strong>{formatMoney(installment.amount)}</strong></td>
                  <td data-label="Durum">
                    <span className={`finance-status card-installment-status is-${installment.status}`}>{statusLabel(installment.status)}</span>
                  </td>
                  <td data-label="Ödeme tarihi">
                    {installment.paidOn === null ? "—" : formatDate(installment.paidOn)}
                  </td>
                  <td data-label="İşlem">
                    {paymentDraft?.installmentId === installment.id ? (
                      <form
                        className="card-payment-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void updateInstallment(installment, "paid", paymentDraft.paidOn);
                        }}
                      >
                        <label>
                          <span>Ödeme tarihi</span>
                          <input
                            aria-label={`${installment.expenseDescription} ${installment.installmentNumber}. taksit ödeme tarihi`}
                            max={istanbulToday()}
                            required
                            type="date"
                            value={paymentDraft.paidOn}
                            onChange={(event) => setPaymentDraft({
                              installmentId: installment.id,
                              paidOn: event.target.value,
                            })}
                          />
                        </label>
                        <div>
                          <button
                            aria-label={`${installment.expenseDescription} ${installment.installmentNumber}. taksit ödemesini kaydet`}
                            className="card-payment-toggle"
                            disabled={updatingInstallmentId !== null}
                            type="submit"
                          >
                            {updatingInstallmentId === installment.id ? "Kaydediliyor…" : "Kaydet"}
                          </button>
                          <button
                            aria-label={`${installment.expenseDescription} ${installment.installmentNumber}. taksit ödeme girişinden vazgeç`}
                            className="card-payment-toggle"
                            disabled={updatingInstallmentId !== null}
                            type="button"
                            onClick={() => setPaymentDraft(null)}
                          >
                            Vazgeç
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        aria-label={`${installment.expenseDescription} ${installment.installmentNumber}. taksitini ${installment.status === "paid" ? "plana geri al" : "ödendi işaretle"}`}
                        className="card-payment-toggle"
                        disabled={updatingInstallmentId !== null}
                        type="button"
                        onClick={() => {
                          if (installment.status === "paid") {
                            void updateInstallment(installment, "planned", null);
                          } else {
                            beginPayment(installment);
                          }
                        }}
                      >
                        {updatingInstallmentId === installment.id
                          ? "İşleniyor…"
                          : installment.status === "paid"
                            ? "Plana geri al"
                            : "Ödendi işaretle"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {installments.length === 0 ? (
                <tr>
                  <td className="empty-row" colSpan={8}>
                    {planLoadState === "loading"
                      ? "Ödeme planı yükleniyor…"
                      : "Bu dönem için kart ödemesi yok."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>}
      </section>
    </section>
  );
}
