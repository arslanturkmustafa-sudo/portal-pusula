"use client";

import {
  useEffect,
  useMemo,
  useRef,
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

type EditableCustomer = Readonly<{
  contactNote?: string | null;
  displayName?: string;
  email?: string | null;
  id: string;
  name: string;
  phone?: string | null;
  shortCode?: string;
  status?: "active" | "inactive";
}>;

type CustomerDto = Readonly<{
  contactNote: string | null;
  displayName: string;
  email: string | null;
  id: string;
  phone: string | null;
  shortCode: string;
  status: "active" | "inactive";
}>;

type CustomerDraft = {
  contactNote: string;
  displayName: string;
  email: string;
  phone: string;
};

type CustomerWorkspaceProps = Readonly<{
  customer: EditableCustomer;
  live: boolean;
  onContractSaved: (contract: ContractDto) => void;
  onCustomerSaved?: (customer: CustomerDto) => void;
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

function customerErrorMessage(status: unknown): string {
  if (status === "validation_error") {
    return "Müşteri bilgilerini kontrol edin. E-posta ve telefon biçimi geçerli olmalıdır.";
  }
  if (status === "customer_not_found") {
    return "Müşteri kaydı bulunamadı. Sayfayı yenileyip yeniden deneyin.";
  }
  return "Müşteri bilgileri kaydedilemedi. Lütfen yeniden deneyin.";
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

function nextIsoDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function sortedContracts(contracts: readonly ContractDto[]): ContractDto[] {
  return [...contracts].sort((left, right) =>
    left.startsOn.localeCompare(right.startsOn) || left.id.localeCompare(right.id),
  );
}

function selectedContractFrom(
  contracts: readonly ContractDto[],
): ContractDto | null {
  const today = istanbulToday();
  const current = contracts.find(
    (item) =>
      item.status === "active" &&
      item.startsOn <= today &&
      item.endsOn >= today,
  );
  return current ?? contracts.at(-1) ?? null;
}

function monthForContract(contract: ContractDto): string {
  const currentMonth = currentIstanbulMonth();
  if (
    `${currentMonth}-01` <= contract.endsOn &&
    `${currentMonth}-31` >= contract.startsOn
  ) {
    return currentMonth;
  }
  return contract.startsOn.slice(0, 7);
}

function nextContractDraft(contracts: readonly ContractDto[]): ContractDraft {
  const latest = sortedContracts(contracts).at(-1);
  if (!latest) return emptyContractDraft();
  const startsOn = nextIsoDate(latest.endsOn);
  return {
    ...contractDraft(latest),
    endsOn: oneYearLessOneDay(startsOn),
    internalNote: "",
    startsOn,
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

function customerDraft(
  customer: Readonly<{
    contactNote?: string | null;
    displayName?: string;
    email?: string | null;
    name?: string;
    phone?: string | null;
  }>,
): CustomerDraft {
  return {
    contactNote: customer.contactNote ?? "",
    displayName: customer.displayName ?? customer.name ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
  };
}

function contractPeriodLabel(contract: ContractDto): string {
  const amount = new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2,
  }).format(Number(contract.monthlyFeeAmount));
  return `${contract.startsOn} – ${contract.endsOn} · ${amount} ₺`;
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
  onCustomerSaved,
  onVisitsSaved,
}: CustomerWorkspaceProps) {
  const [loadState, setLoadState] = useState<LoadState>(
    live ? "loading" : "ready",
  );
  const [contracts, setContracts] = useState<readonly ContractDto[]>([]);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(
    null,
  );
  const [isCreatingContract, setIsCreatingContract] = useState(false);
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
  const [customerRecord, setCustomerRecord] = useState<CustomerDto>(() => ({
    contactNote: customer.contactNote ?? null,
    displayName: customer.displayName ?? customer.name,
    email: customer.email ?? null,
    id: customer.id,
    phone: customer.phone ?? null,
    shortCode: customer.shortCode ?? "",
    status: customer.status ?? "active",
  }));
  const [customerEditDraft, setCustomerEditDraft] = useState<CustomerDraft>(
    () => customerDraft(customer),
  );
  const [customerSaveState, setCustomerSaveState] =
    useState<SaveState>("idle");
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const onContractSavedRef = useRef(onContractSaved);
  const onVisitsSavedRef = useRef(onVisitsSaved);
  const contractCustomerIdRef = useRef(customer.id);
  const contractLoadGenerationRef = useRef(0);
  const contractInteractionRef = useRef<"creating" | "editing" | "idle">(
    "idle",
  );

  useEffect(() => {
    onContractSavedRef.current = onContractSaved;
  }, [onContractSaved]);

  useEffect(() => {
    onVisitsSavedRef.current = onVisitsSaved;
  }, [onVisitsSaved]);

  const contract = useMemo(
    () =>
      isCreatingContract
        ? null
        : contracts.find((item) => item.id === selectedContractId) ?? null,
    [contracts, isCreatingContract, selectedContractId],
  );

  useEffect(() => {
    if (contractCustomerIdRef.current !== customer.id) {
      contractCustomerIdRef.current = customer.id;
      contractInteractionRef.current = "idle";
    }
    const generation = ++contractLoadGenerationRef.current;
    if (!live || contractInteractionRef.current !== "idle") return;
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
        const ordered = sortedContracts(payload.contracts ?? []);
        const selected = selectedContractFrom(ordered);
        if (generation !== contractLoadGenerationRef.current) return;
        if (contractInteractionRef.current !== "idle") return;
        if (selected) setPlanLoadState("loading");
        setContracts(ordered);
        setSelectedContractId(selected?.id ?? null);
        setIsCreatingContract(false);
        setIsEditingContract(false);
        setContractError(null);
        if (selected) {
          setDraft(contractDraft(selected));
          setSelectedMonth(monthForContract(selected));
          onContractSavedRef.current(selected);
        } else {
          setDraft(emptyContractDraft());
          contractInteractionRef.current = "creating";
        }
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (generation !== contractLoadGenerationRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });

    return () => controller.abort();
  }, [customer.id, live]);

  useEffect(() => {
    const hasCompleteCustomer =
      customer.displayName !== undefined &&
      customer.email !== undefined &&
      customer.phone !== undefined &&
      customer.contactNote !== undefined;
    if (!live || hasCompleteCustomer) return;
    const controller = new AbortController();

    void fetch("/api/customers", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Customer list is unavailable.");
        return (await response.json()) as { customers?: CustomerDto[] };
      })
      .then((payload) => {
        const stored = payload.customers?.find((item) => item.id === customer.id);
        if (!stored) return;
        setCustomerRecord(stored);
        setCustomerEditDraft(customerDraft(stored));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [
    customer.contactNote,
    customer.displayName,
    customer.email,
    customer.id,
    customer.phone,
    live,
  ]);

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
        onVisitsSavedRef.current(loadedVisits);
        setPlanError(null);
        setPlanLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPlanLoadState("error");
      });

    return () => controller.abort();
  }, [contract, customer.id, live, selectedMonth]);

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
  const planMutationPending =
    planSaveState === "saving" || visitSaveId !== null;

  function selectContract(contractId: string) {
    if (planMutationPending) return;
    const selected = contracts.find((item) => item.id === contractId);
    if (!selected) return;
    contractInteractionRef.current = "idle";
    contractLoadGenerationRef.current += 1;
    setSelectedContractId(selected.id);
    setIsCreatingContract(false);
    setIsEditingContract(false);
    setDraft(contractDraft(selected));
    setSelectedMonth(monthForContract(selected));
    setVisits([]);
    setPlanLoadState(live ? "loading" : "ready");
    setPlanSaveState("idle");
    setPlanError(null);
    setContractSaveState("idle");
    setContractError(null);
    setPeriodTouched(false);
  }

  function startNewContract() {
    if (planMutationPending) return;
    contractLoadGenerationRef.current += 1;
    contractInteractionRef.current = "creating";
    setIsCreatingContract(true);
    setIsEditingContract(false);
    setDraft(nextContractDraft(contracts));
    setVisits([]);
    setPlanLoadState("ready");
    setPlanSaveState("idle");
    setPlanError(null);
    setContractSaveState("idle");
    setContractError(null);
    setPeriodTouched(false);
  }

  function cancelContractEdit() {
    contractInteractionRef.current = "idle";
    if (isCreatingContract) {
      const selected = contracts.find((item) => item.id === selectedContractId);
      setIsCreatingContract(false);
      if (selected) {
        setDraft(contractDraft(selected));
        setSelectedMonth(monthForContract(selected));
        setPlanLoadState(live ? "loading" : "ready");
      }
    } else if (contract) {
      setDraft(contractDraft(contract));
    }
    setContractError(null);
    setContractSaveState("idle");
    setIsEditingContract(false);
    setPeriodTouched(false);
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!live || !isEditingCustomer) return;
    const formData = new FormData(event.currentTarget);
    const submitted: CustomerDraft = {
      contactNote: formText(formData, "customerContactNote").trim(),
      displayName: formText(formData, "customerDisplayName").trim(),
      email: formText(formData, "customerEmail").trim().toLowerCase(),
      phone: formText(formData, "customerPhone").trim(),
    };
    const body: Record<string, string | null> = {};
    if (submitted.displayName !== customerRecord.displayName) {
      body.displayName = submitted.displayName;
    }
    if ((submitted.email || null) !== customerRecord.email) {
      body.email = submitted.email || null;
    }
    if ((submitted.phone || null) !== customerRecord.phone) {
      body.phone = submitted.phone || null;
    }
    if ((submitted.contactNote || null) !== customerRecord.contactNote) {
      body.contactNote = submitted.contactNote || null;
    }
    if (Object.keys(body).length === 0) {
      setIsEditingCustomer(false);
      setCustomerSaveState("idle");
      setCustomerError(null);
      return;
    }

    setCustomerSaveState("saving");
    setCustomerError(null);
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json()) as {
        customer?: CustomerDto;
        status?: string;
      };
      if (!response.ok || payload.customer === undefined) {
        setCustomerSaveState("error");
        setCustomerError(customerErrorMessage(payload.status));
        return;
      }
      setCustomerRecord(payload.customer);
      setCustomerEditDraft(customerDraft(payload.customer));
      setCustomerSaveState("idle");
      setCustomerError(null);
      setIsEditingCustomer(false);
      onCustomerSaved?.(payload.customer);
    } catch {
      setCustomerSaveState("error");
      setCustomerError(customerErrorMessage(null));
    }
  }

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
      const nextContracts = sortedContracts([
        ...contracts.filter((item) => item.id !== payload.contract?.id),
        payload.contract,
      ]);
      setContracts(nextContracts);
      setSelectedContractId(payload.contract.id);
      setIsCreatingContract(false);
      setPlanLoadState("loading");
      setSelectedMonth(monthForContract(payload.contract));
      setDraft(contractDraft(payload.contract));
      setContractSaveState("idle");
      setContractError(null);
      contractLoadGenerationRef.current += 1;
      contractInteractionRef.current = "idle";
      setIsEditingContract(false);
      setPeriodTouched(false);
      onContractSaved(selectedContractFrom(nextContracts) ?? payload.contract);
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
          <h2 id="customer-workspace-title">{customerRecord.displayName}</h2>
        </div>
        <span>
          {contracts.length > 0
            ? `${contracts.length} çalışma dönemi`
            : "Sözleşme bekliyor"}
        </span>
      </header>

      <div className="customer-profile-sheet">
        <div className="workspace-section-title">
          <span>00</span>
          <div>
            <h3>Müşteri bilgileri</h3>
            <p>İletişim ve kayıt bilgilerini buradan güncelleyin.</p>
          </div>
        </div>

        {isEditingCustomer ? (
          <form className="customer-profile-form" onSubmit={saveCustomer}>
            <label>
              <span>Müşteri / şirket adı</span>
              <input
                maxLength={191}
                name="customerDisplayName"
                required
                value={customerEditDraft.displayName}
                onChange={(event) =>
                  setCustomerEditDraft((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>E-posta</span>
              <input
                autoComplete="email"
                maxLength={254}
                name="customerEmail"
                type="email"
                value={customerEditDraft.email}
                onChange={(event) =>
                  setCustomerEditDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Telefon</span>
              <input
                autoComplete="tel"
                maxLength={32}
                name="customerPhone"
                type="tel"
                value={customerEditDraft.phone}
                onChange={(event) =>
                  setCustomerEditDraft((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </label>
            <label className="customer-profile-note">
              <span>İletişim notu</span>
              <textarea
                maxLength={2000}
                name="customerContactNote"
                rows={2}
                value={customerEditDraft.contactNote}
                onChange={(event) =>
                  setCustomerEditDraft((current) => ({
                    ...current,
                    contactNote: event.target.value,
                  }))
                }
              />
            </label>
            <div className="customer-profile-actions">
              <button
                className="text-action"
                disabled={customerSaveState === "saving"}
                type="button"
                onClick={() => {
                  setCustomerEditDraft(customerDraft(customerRecord));
                  setCustomerSaveState("idle");
                  setCustomerError(null);
                  setIsEditingCustomer(false);
                }}
              >
                İptal
              </button>
              <button
                className="primary-action"
                disabled={customerSaveState === "saving" || !live}
                type="submit"
              >
                {customerSaveState === "saving"
                  ? "Kaydediliyor…"
                  : "Müşteri bilgilerini kaydet"}
              </button>
            </div>
            {customerSaveState === "error" && customerError !== null ? (
              <p className="entry-error" role="alert">{customerError}</p>
            ) : null}
          </form>
        ) : (
          <div className="customer-profile-summary">
            <dl>
              <div><dt>E-posta</dt><dd>{customerRecord.email ?? "—"}</dd></div>
              <div><dt>Telefon</dt><dd>{customerRecord.phone ?? "—"}</dd></div>
              <div>
                <dt>İletişim notu</dt>
                <dd>{customerRecord.contactNote ?? "—"}</dd>
              </div>
            </dl>
            <button
              className="text-action"
              type="button"
              onClick={() => {
                setCustomerEditDraft(customerDraft(customerRecord));
                setCustomerSaveState("idle");
                setCustomerError(null);
                setIsEditingCustomer(true);
              }}
            >
              Müşteri bilgilerini düzenle
            </button>
          </div>
        )}
      </div>

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
                <p>Yıllık sözleşme dönemlerini ve her dönemin ücretini yönetin.</p>
              </div>
            </div>

            <div className="contract-period-toolbar">
              <div className="contract-period-list" aria-label="Çalışma dönemleri">
                {contracts.map((item) => (
                  <button
                    aria-pressed={!isCreatingContract && item.id === contract?.id}
                    className={
                      !isCreatingContract && item.id === contract?.id
                        ? "is-selected"
                        : undefined
                    }
                    key={item.id}
                    disabled={
                      isCreatingContract ||
                      isEditingContract ||
                      contractSaveState === "saving" ||
                      planMutationPending
                    }
                    type="button"
                    onClick={() => selectContract(item.id)}
                  >
                    <strong>{contractPeriodLabel(item)}</strong>
                    <small>
                      {item.status === "active"
                        ? "Aktif"
                        : item.status === "draft"
                          ? "Taslak"
                          : "Kapalı"}
                    </small>
                  </button>
                ))}
              </div>
              <button
                className="text-action"
                disabled={
                  isCreatingContract ||
                  isEditingContract ||
                  contractSaveState === "saving" ||
                  planMutationPending
                }
                type="button"
                onClick={startNewContract}
              >
                + Yeni dönem ekle
              </button>
            </div>

            {isCreatingContract ? (
              <p className="workspace-message">
                Yeni çalışma dönemi hazırlanıyor. Tarih ve ücret bilgilerini kontrol edin.
              </p>
            ) : null}

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
                  <>
                    {isCreatingContract && contracts.length > 0 ? (
                      <button
                        className="text-action"
                        disabled={contractSaveState === "saving"}
                        type="button"
                        onClick={cancelContractEdit}
                      >
                        Vazgeç
                      </button>
                    ) : null}
                    <button
                      className="primary-action"
                      disabled={contractSaveState === "saving" || !live}
                      type="submit"
                    >
                      {!live
                        ? "Önizleme kaydı"
                        : contractSaveState === "saving"
                          ? "Kaydediliyor…"
                          : isCreatingContract
                            ? "Yeni dönemi kaydet"
                            : "Sözleşmeyi kaydet"}
                    </button>
                  </>
                ) : isEditingContract ? (
                  <>
                    <button
                      className="text-action"
                      disabled={contractSaveState === "saving"}
                      type="button"
                      onClick={cancelContractEdit}
                    >
                      İptal
                    </button>
                    <button
                      className="primary-action"
                      disabled={contractSaveState === "saving"}
                      key="save-contract-changes"
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
                      key="start-contract-edit"
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        setContractError(null);
                        setContractSaveState("idle");
                        setPeriodTouched(true);
                        contractLoadGenerationRef.current += 1;
                        contractInteractionRef.current = "editing";
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
