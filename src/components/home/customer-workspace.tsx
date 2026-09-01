"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type VatMode = "exempt" | "exclusive" | "inclusive";
type VisitStatus =
  | "planned"
  | "completed"
  | "makeup_pending"
  | "cancelled_by_agreement";

type ContractDto = Readonly<{
  currency: "TRY";
  customerId: string;
  endsOn: string;
  id: string;
  internalNote: string | null;
  monthlyFeeAmount: string;
  paymentDay: number;
  startsOn: string;
  status: "draft" | "active" | "closed";
  vatMode: VatMode;
  vatRate: string;
}>;

type VisitDto = Readonly<{
  committedOn: string;
  deliveredOn: string | null;
  id: string;
  internalDurationMinutes: number | null;
  internalPlannedAtUtc: string | null;
  resolutionNote: string | null;
  resolutionStatus: VisitStatus;
}>;

type VisitDraft = {
  committedOn: string;
  deliveredOn: string | null;
  id: string | null;
  internalDurationMinutes: string;
  internalStartTime: string;
  resolutionNote: string;
  resolutionStatus: VisitStatus;
};

type ContractDraft = {
  endsOn: string;
  internalNote: string;
  monthlyFeeAmount: string;
  paymentDay: string;
  startsOn: string;
  vatMode: VatMode;
  vatRate: string;
};

type CustomerWorkspaceProps = Readonly<{
  customer: Readonly<{ id: string; name: string }>;
  live: boolean;
  onContractSaved: (contract: ContractDto) => void;
  onVisitsSaved: (visits: readonly VisitDto[]) => void;
}>;

type LoadState = "error" | "loading" | "ready";
type SaveState = "error" | "idle" | "saving";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function contractErrorMessage(status: unknown): string {
  if (status === "contract_period_conflict") {
    return "Bu tarih aralığı müşterinin başka bir sözleşmesiyle çakışıyor.";
  }
  if (status === "contract_visit_range_conflict") {
    return "Yeni tarih aralığının dışında kalan ziyaretler var. Önce bu ziyaretleri düzenleyin.";
  }
  if (status === "validation_error") {
    return "Bitiş tarihi başlangıçtan önce olamaz; ücret, ödeme günü ve KDV alanlarını da kontrol edin.";
  }
  return "Sözleşme kaydedilemedi. Lütfen yeniden deneyin.";
}

function planErrorMessage(status: unknown): string {
  if (status === "month_outside_contract") {
    return "Seçilen ay veya ziyaret günü sözleşme tarihleri dışında.";
  }
  if (status === "month_plan_locked") {
    return "Gerçekleşme kaydı bulunan ay topluca değiştirilemez.";
  }
  if (status === "validation_error") {
    return "Ziyaret günleri tekrarlanamaz; tarih, saat ve süre alanlarını kontrol edin.";
  }
  return "Aylık plan kaydedilemedi. Lütfen yeniden deneyin.";
}

function istanbulToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function oneYearLessOneDay(startsOn: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(startsOn)) return "";
  const [year, month, day] = startsOn.split("-").map(Number);
  const next = new Date(Date.UTC(year + 1, month - 1, day));
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

function emptyContractDraft(): ContractDraft {
  const startsOn = istanbulToday();
  return {
    endsOn: oneYearLessOneDay(startsOn),
    internalNote: "",
    monthlyFeeAmount: "50000",
    paymentDay: "5",
    startsOn,
    vatMode: "exclusive",
    vatRate: "20",
  };
}

function currentIstanbulMonth(): string {
  return istanbulToday().slice(0, 7);
}

function localTimeFromUtc(value: string | null): string {
  if (value === null) return "";
  const canonical = value.includes("T")
    ? value
    : `${value.replace(" ", "T").slice(0, 23)}Z`;
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(canonical));
}

function visitDraft(visit?: VisitDto): VisitDraft {
  return {
    committedOn: visit?.committedOn ?? "",
    deliveredOn: visit?.deliveredOn ?? null,
    id: visit?.id ?? null,
    internalDurationMinutes:
      visit?.internalDurationMinutes === null ||
      visit?.internalDurationMinutes === undefined
        ? ""
        : String(visit.internalDurationMinutes),
    internalStartTime: localTimeFromUtc(visit?.internalPlannedAtUtc ?? null),
    resolutionNote: visit?.resolutionNote ?? "",
    resolutionStatus: visit?.resolutionStatus ?? "planned",
  };
}

function contractDraft(contract: ContractDto): ContractDraft {
  return {
    endsOn: contract.endsOn,
    internalNote: contract.internalNote ?? "",
    monthlyFeeAmount: contract.monthlyFeeAmount.replace(/\.0+$/u, ""),
    paymentDay: String(contract.paymentDay),
    startsOn: contract.startsOn,
    vatMode: contract.vatMode,
    vatRate: contract.vatRate.replace(/\.0+$/u, ""),
  };
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    currency: "TRY",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function visitStatusLabel(status: VisitStatus): string {
  return {
    cancelled_by_agreement: "Mutabakatla iptal",
    completed: "Tamamlandı",
    makeup_pending: "Telafi bekliyor",
    planned: "Planlandı",
  }[status];
}

export function CustomerWorkspace(props: CustomerWorkspaceProps) {
  return <CustomerWorkspaceSession key={props.customer.id} {...props} />;
}

function CustomerWorkspaceSession({
  customer,
  live,
  onContractSaved,
  onVisitsSaved,
}: CustomerWorkspaceProps) {
  const [loadState, setLoadState] = useState<LoadState>(
    live ? "loading" : "ready",
  );
  const [contract, setContract] = useState<ContractDto | null>(null);
  const [draft, setDraft] = useState<ContractDraft>(emptyContractDraft);
  const [contractSaveState, setContractSaveState] =
    useState<SaveState>("idle");
  const [contractError, setContractError] = useState<string | null>(null);
  const [isEditingContract, setIsEditingContract] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentIstanbulMonth);
  const [visits, setVisits] = useState<VisitDraft[]>([]);
  const [planLoadState, setPlanLoadState] = useState<LoadState>("ready");
  const [planSaveState, setPlanSaveState] = useState<SaveState>("idle");
  const [planError, setPlanError] = useState<string | null>(null);
  const [visitSaveId, setVisitSaveId] = useState<string | null>(null);
  const [periodTouched, setPeriodTouched] = useState(false);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();

    void fetch(`/api/customers/${customer.id}/contracts`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Contract list is unavailable.");
        return (await response.json()) as { contracts?: ContractDto[] };
      })
      .then((payload) => {
        const selected =
          payload.contracts?.find((item) => item.status === "active") ??
          payload.contracts?.[0] ??
          null;
        if (selected) setPlanLoadState("loading");
        setContract(selected);
        setIsEditingContract(false);
        setContractError(null);
        if (selected) {
          setDraft(contractDraft(selected));
          onContractSaved(selected);
        }
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });

    return () => controller.abort();
  }, [customer.id, live, onContractSaved]);

  useEffect(() => {
    if (!live || contract === null) return;
    const controller = new AbortController();

    void fetch(
      `/api/customers/${customer.id}/contracts/${contract.id}/month-plans/${selectedMonth}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Monthly plan is unavailable.");
        return (await response.json()) as {
          monthPlan?: { visits?: VisitDto[] };
        };
      })
      .then((payload) => {
        const loadedVisits = payload.monthPlan?.visits ?? [];
        setVisits(loadedVisits.map(visitDraft));
        onVisitsSaved(loadedVisits);
        setPlanError(null);
        setPlanLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPlanLoadState("error");
      });

    return () => controller.abort();
  }, [contract, customer.id, live, onVisitsSaved, selectedMonth]);

  const financialPreview = useMemo(() => {
    const amount = Number(draft.monthlyFeeAmount.replace(",", "."));
    const rate = Number(draft.vatRate.replace(",", "."));
    if (!Number.isFinite(amount) || !Number.isFinite(rate)) {
      return { net: Number.NaN, total: Number.NaN, vat: Number.NaN };
    }
    if (draft.vatMode === "exclusive") {
      const vat = amount * (rate / 100);
      return { net: amount, total: amount + vat, vat };
    }
    if (draft.vatMode === "inclusive") {
      const vat = amount * (rate / (100 + rate));
      return { net: amount - vat, total: amount, vat };
    }
    return { net: amount, total: amount, vat: 0 };
  }, [draft.monthlyFeeAmount, draft.vatMode, draft.vatRate]);

  const monthLocked = visits.some(
    (visit) => visit.resolutionStatus !== "planned",
  );

  async function saveContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!live || (contract !== null && !isEditingContract)) return;
    const formData = new FormData(event.currentTarget);
    const submittedDraft: ContractDraft = {
      endsOn: formText(formData, "endsOn"),
      internalNote: formText(formData, "internalNote"),
      monthlyFeeAmount: formText(formData, "monthlyFeeAmount"),
      paymentDay: formText(formData, "paymentDay"),
      startsOn: formText(formData, "startsOn"),
      vatMode: formText(formData, "vatMode") as VatMode,
      vatRate:
        formText(formData, "vatMode") === "exempt"
          ? "0"
          : formText(formData, "vatRate"),
    };

    if (
      submittedDraft.startsOn === "" ||
      submittedDraft.endsOn === "" ||
      submittedDraft.endsOn < submittedDraft.startsOn
    ) {
      setContractSaveState("error");
      setContractError(contractErrorMessage("validation_error"));
      return;
    }

    setContractSaveState("saving");
    setContractError(null);

    try {
      const endpoint =
        contract === null
          ? `/api/customers/${customer.id}/contracts`
          : `/api/customers/${customer.id}/contracts/${contract.id}`;
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          endsOn: submittedDraft.endsOn,
          internalNote: submittedDraft.internalNote,
          monthlyFeeAmount: submittedDraft.monthlyFeeAmount.replace(",", "."),
          paymentDay: Number(submittedDraft.paymentDay),
          startsOn: submittedDraft.startsOn,
          status: contract?.status ?? "active",
          vatMode: submittedDraft.vatMode,
          vatRate:
            submittedDraft.vatMode === "exempt"
              ? "0"
              : submittedDraft.vatRate.replace(",", "."),
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: contract === null ? "POST" : "PATCH",
      });
      const payload = (await response.json()) as {
        contract?: ContractDto;
        status?: string;
      };
      if (!response.ok || payload.contract === undefined) {
        setContractSaveState("error");
        setContractError(contractErrorMessage(payload.status));
        return;
      }
      setPlanLoadState("loading");
      setContract(payload.contract);
      setDraft(contractDraft(payload.contract));
      setContractSaveState("idle");
      setContractError(null);
      setIsEditingContract(false);
      setPeriodTouched(false);
      onContractSaved(payload.contract);
    } catch {
      setContractSaveState("error");
      setContractError(contractErrorMessage(null));
    }
  }

  function updateVisit(index: number, next: Partial<VisitDraft>) {
    setVisits((current) =>
      current.map((visit, visitIndex) =>
        visitIndex === index ? { ...visit, ...next } : visit,
      ),
    );
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!live || contract === null || monthLocked) return;
    const formData = new FormData(event.currentTarget);
    const planMonth = formText(formData, "selectedMonth");
    const submittedVisits = visits.map((visit, index) => ({
      committedOn: formText(formData, `visits.${index}.committedOn`),
      internalDurationMinutes:
        formText(formData, `visits.${index}.internalDurationMinutes`) === ""
          ? null
          : Number(
              formText(formData, `visits.${index}.internalDurationMinutes`),
            ),
      internalStartTime:
        formText(formData, `visits.${index}.internalStartTime`) || null,
    }));

    if (
      !/^\d{4}-\d{2}$/u.test(planMonth) ||
      submittedVisits.some((visit) => visit.committedOn === "") ||
      new Set(submittedVisits.map((visit) => visit.committedOn)).size !==
        submittedVisits.length
    ) {
      setPlanSaveState("error");
      setPlanError(planErrorMessage("validation_error"));
      return;
    }

    setPlanSaveState("saving");
    setPlanError(null);
    try {
      const response = await fetch(
        `/api/customers/${customer.id}/contracts/${contract.id}/month-plans/${planMonth}`,
        {
          body: JSON.stringify({
            visits: submittedVisits,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const payload = (await response.json()) as {
        monthPlan?: { visits: VisitDto[] };
        status?: string;
      };
      if (!response.ok || payload.monthPlan === undefined) {
        setPlanSaveState("error");
        setPlanError(planErrorMessage(payload.status));
        return;
      }
      setVisits(payload.monthPlan.visits.map(visitDraft));
      setSelectedMonth(planMonth);
      setPlanSaveState("idle");
      setPlanError(null);
      onVisitsSaved(payload.monthPlan.visits);
    } catch {
      setPlanSaveState("error");
      setPlanError(planErrorMessage(null));
    }
  }

  async function saveVisitResolution(index: number) {
    const visit = visits[index];
    if (!live || contract === null || !visit?.id) return;
    setVisitSaveId(visit.id);
    setPlanError(null);
    setPlanSaveState("idle");
    try {
      const response = await fetch(
        `/api/customers/${customer.id}/contracts/${contract.id}/visits/${visit.id}`,
        {
          body: JSON.stringify({
            deliveredOn:
              visit.resolutionStatus === "completed"
                ? visit.deliveredOn || visit.committedOn
                : null,
            resolutionNote: visit.resolutionNote,
            resolutionStatus: visit.resolutionStatus,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      if (!response.ok) throw new Error("Visit could not be updated.");
      const payload = (await response.json()) as { visit: VisitDto };
      updateVisit(index, visitDraft(payload.visit));
      setVisitSaveId(null);
      setPlanError(null);
      setPlanSaveState("idle");
      onVisitsSaved(
        visits.map((item, itemIndex) =>
          itemIndex === index ? payload.visit : (item as unknown as VisitDto),
        ),
      );
    } catch {
      setVisitSaveId(null);
      setPlanSaveState("error");
      setPlanError(planErrorMessage(null));
    }
  }

  return (
    <section className="customer-workspace" aria-labelledby="customer-workspace-title">
      <header className="customer-workspace-heading">
        <div>
          <p className="section-kicker">Müşteri çalışma kaydı</p>
          <h2 id="customer-workspace-title">{customer.name}</h2>
        </div>
        <span>{contract ? "Sözleşme açık" : "Sözleşme bekliyor"}</span>
      </header>

      {loadState === "loading" ? (
        <p className="workspace-message">Sözleşme bilgileri yükleniyor…</p>
      ) : loadState === "error" ? (
        <p className="entry-error" role="alert">
          Sözleşme bilgilerine ulaşılamadı. Sayfayı yenileyip yeniden deneyin.
        </p>
      ) : (
        <div className="customer-workspace-grid">
          <div className="contract-sheet">
            <div className="workspace-section-title">
              <span>01</span>
              <div>
                <h3>Çalışma şartları</h3>
                <p>Aylık danışmanlık sözleşmesinin temel kaydı.</p>
              </div>
            </div>

            <form className="contract-form" onSubmit={saveContract}>
              <label>
                <span>Başlangıç</span>
                <input
                  disabled={contract !== null && !isEditingContract}
                  name="startsOn"
                  required
                  type="date"
                  value={draft.startsOn}
                  onInput={(event) => {
                    const startsOn = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      endsOn: periodTouched || contract !== null
                        ? current.endsOn
                        : oneYearLessOneDay(startsOn),
                      startsOn,
                    }));
                  }}
                />
              </label>
              <label>
                <span>Bitiş</span>
                <input
                  disabled={contract !== null && !isEditingContract}
                  name="endsOn"
                  required
                  type="date"
                  value={draft.endsOn}
                  onInput={(event) => {
                    const endsOn = event.currentTarget.value;
                    setPeriodTouched(true);
                    setDraft((current) => ({
                      ...current,
                      endsOn,
                    }));
                  }}
                />
              </label>
              <label>
                <span>Aylık ücret</span>
                <input
                  disabled={contract !== null && !isEditingContract}
                  inputMode="decimal"
                  name="monthlyFeeAmount"
                  required
                  value={draft.monthlyFeeAmount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      monthlyFeeAmount: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>KDV şekli</span>
                <select
                  disabled={contract !== null && !isEditingContract}
                  name="vatMode"
                  value={draft.vatMode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      vatMode: event.target.value as VatMode,
                    }))
                  }
                >
                  <option value="exempt">KDV uygulanmaz</option>
                  <option value="exclusive">Ücrete KDV eklenir</option>
                  <option value="inclusive">KDV ücrete dahil</option>
                </select>
              </label>
              <label>
                <span>KDV oranı (%)</span>
                <input
                  disabled={
                    (contract !== null && !isEditingContract) ||
                    draft.vatMode === "exempt"
                  }
                  inputMode="decimal"
                  name="vatRate"
                  required={draft.vatMode !== "exempt"}
                  value={draft.vatMode === "exempt" ? "0" : draft.vatRate}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      vatRate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Ödeme günü</span>
                <input
                  disabled={contract !== null && !isEditingContract}
                  max={31}
                  min={1}
                  name="paymentDay"
                  required
                  type="number"
                  value={draft.paymentDay}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      paymentDay: event.target.value,
                    }))
                  }
                />
                <small>Kısa aylarda son geçerli gün esas alınır.</small>
              </label>
              <label className="contract-note">
                <span>İç not</span>
                <textarea
                  disabled={contract !== null && !isEditingContract}
                  maxLength={2000}
                  name="internalNote"
                  rows={2}
                  value={draft.internalNote}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      internalNote: event.target.value,
                    }))
                  }
                />
              </label>

              <dl className="contract-checkline" aria-label="Sözleşme ön kontrolü">
                <div><dt>Net</dt><dd>{formatMoney(financialPreview.net)}</dd></div>
                <div><dt>KDV</dt><dd>{formatMoney(financialPreview.vat)}</dd></div>
                <div><dt>Aylık toplam</dt><dd>{formatMoney(financialPreview.total)}</dd></div>
                <div><dt>Vade</dt><dd>Ayın {draft.paymentDay || "—"}. günü</dd></div>
              </dl>

              <div className="contract-actions">
                {contract === null ? (
                  <button
                    className="primary-action"
                    disabled={contractSaveState === "saving" || !live}
                    type="submit"
                  >
                    {!live
                      ? "Önizleme kaydı"
                      : contractSaveState === "saving"
                        ? "Kaydediliyor…"
                        : "Sözleşmeyi kaydet"}
                  </button>
                ) : isEditingContract ? (
                  <>
                    <button
                      className="text-action"
                      disabled={contractSaveState === "saving"}
                      type="button"
                      onClick={() => {
                        setDraft(contractDraft(contract));
                        setContractError(null);
                        setContractSaveState("idle");
                        setIsEditingContract(false);
                      }}
                    >
                      İptal
                    </button>
                    <button
                      className="primary-action"
                      disabled={contractSaveState === "saving"}
                      type="submit"
                    >
                      {contractSaveState === "saving"
                        ? "Kaydediliyor…"
                        : "Değişiklikleri kaydet"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="saved-line">Sözleşme kaydı güncel.</p>
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => {
                        setContractError(null);
                        setContractSaveState("idle");
                        setPeriodTouched(true);
                        setIsEditingContract(true);
                      }}
                    >
                      Sözleşmeyi düzenle
                    </button>
                  </>
                )}
              </div>
              {contractSaveState === "error" && contractError !== null ? (
                <p className="entry-error" role="alert">
                  {contractError}
                </p>
              ) : null}
            </form>
          </div>

          <div className="visit-sheet">
            <div className="workspace-section-title">
              <span>02</span>
              <div>
                <h3>Aylık ziyaret planı</h3>
                <p>Vaat edilen günü seçin; saat ve süre yalnız iç planınızdır.</p>
              </div>
            </div>

            {contract === null ? (
              <p className="workspace-message">Önce sözleşmeyi kaydedin.</p>
            ) : (
              <form className="visit-plan-form" onSubmit={savePlan}>
                <div className="month-toolbar">
                  <label>
                    <span>Plan ayı</span>
                    <input
                      name="selectedMonth"
                      type="month"
                      value={selectedMonth}
                      onInput={(event) => {
                        if (!/^\d{4}-\d{2}$/u.test(event.currentTarget.value)) {
                          return;
                        }
                        setPlanLoadState("loading");
                        setPlanError(null);
                        setPlanSaveState("idle");
                        setSelectedMonth(event.currentTarget.value);
                      }}
                    />
                  </label>
                  <button
                    className="text-action"
                    disabled={monthLocked}
                    type="button"
                    onClick={() => setVisits((current) => [...current, visitDraft()])}
                  >
                    + Ziyaret satırı
                  </button>
                </div>

                {planLoadState === "loading" ? (
                  <p className="workspace-message">Ay planı yükleniyor…</p>
                ) : planLoadState === "error" ? (
                  <p className="entry-error" role="alert">Ay planı yüklenemedi.</p>
                ) : (
                  <div className="visit-list">
                    {visits.map((visit, index) => (
                      <div className="visit-row" key={visit.id ?? `new-${index}`}>
                        <label>
                          <span>Ziyaret günü</span>
                          <input
                            disabled={monthLocked}
                            name={`visits.${index}.committedOn`}
                            required
                            type="date"
                            value={visit.committedOn}
                            onInput={(event) =>
                              updateVisit(index, {
                                committedOn: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>İç saat</span>
                          <input
                            disabled={monthLocked}
                            name={`visits.${index}.internalStartTime`}
                            type="time"
                            value={visit.internalStartTime}
                            onChange={(event) =>
                              updateVisit(index, { internalStartTime: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          <span>Süre (dk)</span>
                          <input
                            disabled={monthLocked}
                            max={720}
                            min={15}
                            name={`visits.${index}.internalDurationMinutes`}
                            step={15}
                            type="number"
                            value={visit.internalDurationMinutes}
                            onChange={(event) =>
                              updateVisit(index, {
                                internalDurationMinutes: event.target.value,
                              })
                            }
                          />
                        </label>
                        {visit.resolutionStatus === "planned" && !monthLocked ? (
                          <button
                            aria-label="Ziyaret satırını kaldır"
                            className="visit-remove"
                            type="button"
                            onClick={() =>
                              setVisits((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                          >
                            {visit.id === null ? "Kaldır" : "Plandan çıkar"}
                          </button>
                        ) : null}
                        {visit.id !== null ? (
                          <>
                            <label>
                              <span>Durum</span>
                              <select
                                disabled={
                                  visit.resolutionStatus === "completed" ||
                                  visit.resolutionStatus === "cancelled_by_agreement"
                                }
                                value={visit.resolutionStatus}
                                onChange={(event) => {
                                  const resolutionStatus = event.target.value as VisitStatus;
                                  updateVisit(index, {
                                    deliveredOn:
                                      resolutionStatus === "completed"
                                        ? visit.deliveredOn || visit.committedOn
                                        : null,
                                    resolutionStatus,
                                  });
                                }}
                              >
                                <option value="planned">Planlandı</option>
                                <option value="completed">Tamamlandı</option>
                                <option value="makeup_pending">Telafi bekliyor</option>
                                <option value="cancelled_by_agreement">Mutabakatla iptal</option>
                              </select>
                            </label>
                            {visit.resolutionStatus === "completed" ? (
                              <label>
                                <span>Gerçekleşen gün</span>
                                <input
                                  name={`visits.${index}.deliveredOn`}
                                  type="date"
                                  value={visit.deliveredOn ?? visit.committedOn}
                                  onInput={(event) =>
                                    updateVisit(index, {
                                      deliveredOn: event.currentTarget.value,
                                    })
                                  }
                                />
                              </label>
                            ) : null}
                            {visit.resolutionStatus !== "planned" ? (
                              <label className="visit-note">
                                <span>Açıklama</span>
                                <input
                                  required={visit.resolutionStatus === "cancelled_by_agreement"}
                                  value={visit.resolutionNote}
                                  onChange={(event) =>
                                    updateVisit(index, { resolutionNote: event.target.value })
                                  }
                                />
                              </label>
                            ) : null}
                            <button
                              className="text-action visit-resolution-save"
                              disabled={visitSaveId === visit.id}
                              type="button"
                              onClick={() => void saveVisitResolution(index)}
                            >
                              {visitSaveId === visit.id
                                ? "Kaydediliyor…"
                                : visitStatusLabel(visit.resolutionStatus)}
                            </button>
                          </>
                        ) : null}
                      </div>
                    ))}
                    {visits.length === 0 ? (
                      <p className="workspace-message">Bu ay için henüz ziyaret günü yok.</p>
                    ) : null}
                  </div>
                )}

                {monthLocked ? (
                  <p className="plan-lock-note">
                    Gerçekleşme kaydı bulunan ay topluca değiştirilmez; ziyaretleri tek tek güncelleyin.
                  </p>
                ) : (
                  <button
                    className="primary-action plan-submit"
                    disabled={planSaveState === "saving"}
                    type="submit"
                  >
                    {planSaveState === "saving" ? "Kaydediliyor…" : "Aylık planı kaydet"}
                  </button>
                )}
                {planSaveState === "error" && planError !== null ? (
                  <p className="entry-error" role="alert">
                    {planError}
                  </p>
                ) : null}
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
