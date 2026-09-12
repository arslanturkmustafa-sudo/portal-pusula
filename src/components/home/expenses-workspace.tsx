"use client";

import Decimal from "decimal.js";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";
import { RecordLifecycleControls } from "@/components/portal/record-lifecycle-controls";

type LoadState = "error" | "loading" | "ready";
type SaveState = "idle" | "saving";
type EditorMode = "copy" | "create" | "edit" | null;
type ExpenseRecordKind = "one_time" | "recurring";
type ExpenseStatus = "active" | "voided";
type PaymentMethod = "bank_transfer" | "cash" | "credit_card" | "other";
type ExpenseCategory = string;
type DocumentType = "invoice" | "none" | "other" | "receipt";
type RecurringFrequency = "monthly" | "weekly";
type RecurringStatus = "active" | "paused";

type ExpenseCategoryDto = Readonly<{
  code: string;
  displayName: string;
  id: string;
  isSystem: boolean;
}>;

type ProjectDto = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: "active" | "cancelled" | "completed" | "on_hold" | "planned";
}>;

type CreditCardDto = Readonly<{
  bankName: string | null;
  creditLimitAmount: string | null;
  displayName: string;
  id: string;
  lastFour: string | null;
  note: string | null;
  paymentDueDay: number;
  statementClosingDay: number;
  status: "active" | "inactive";
  version: number;
}>;

type FinanceAccountDto = Readonly<{
  accountType: "bank" | "cash";
  bankName: string | null;
  displayName: string;
  id: string;
  status: "active" | "inactive";
}>;

type ExpenseDto = Readonly<{
  category: ExpenseCategory;
  createdAtUtc?: string;
  creditCardId: string | null;
  creditCardName: string | null;
  description: string;
  documentNumber: string | null;
  documentType: DocumentType;
  id: string;
  incurredOn: string;
  installmentCount: number;
  financeTransactionId?: string | null;
  netAmount: string;
  note: string | null;
  paymentMethod: PaymentMethod;
  projectId: string | null;
  projectName: string | null;
  projectShortCode: string | null;
  sourceAccountId?: string | null;
  sourceAccountName?: string | null;
  sourceAccountType?: "bank" | "cash" | null;
  status: ExpenseStatus;
  totalAmount: string;
  updatedAtUtc?: string;
  vatAmount: string;
  vendorName: string | null;
  version: number;
  voidReason?: string | null;
}>;

type ExpenseDraft = {
  category: ExpenseCategory;
  creditCardId: string;
  description: string;
  documentNumber: string;
  documentType: DocumentType;
  incurredOn: string;
  installmentCount: string;
  netAmount: string;
  note: string;
  paymentMethod: PaymentMethod;
  projectId: string;
  sourceAccountId: string;
  vatAmount: string;
  vendorName: string;
};

type RecurringExpensePlanDto = Readonly<{
  anchorDay: number;
  category: ExpenseCategory;
  creditCardId: string | null;
  creditCardName: string | null;
  description: string;
  endsOn: string | null;
  frequency: RecurringFrequency;
  id: string;
  netAmount: string;
  nextDueOn: string;
  note: string | null;
  paymentMethod: PaymentMethod;
  projectId: string | null;
  projectName: string | null;
  projectShortCode: string | null;
  sourceAccountId: string | null;
  sourceAccountName: string | null;
  sourceAccountType: "bank" | "cash" | null;
  status: RecurringStatus;
  totalAmount: string;
  vatAmount: string;
  vendorName: string | null;
  version: number;
}>;

type RecurringDraft = {
  endsOn: string;
  frequency: RecurringFrequency;
  nextDueOn: string;
};

const fallbackCategoryDefinitions: readonly ExpenseCategoryDto[] = [
  { code: "rent", displayName: "Kira", id: "rent", isSystem: true },
  {
    code: "software_subscription",
    displayName: "Yazılım / abonelik",
    id: "software_subscription",
    isSystem: true,
  },
  {
    code: "transportation",
    displayName: "Ulaşım",
    id: "transportation",
    isSystem: true,
  },
  {
    code: "meals_hospitality",
    displayName: "Yemek / ağırlama",
    id: "meals_hospitality",
    isSystem: true,
  },
  { code: "marketing", displayName: "Pazarlama", id: "marketing", isSystem: true },
  { code: "office", displayName: "Ofis", id: "office", isSystem: true },
  {
    code: "external_service",
    displayName: "Dış hizmet",
    id: "external_service",
    isSystem: true,
  },
  { code: "tax_fee", displayName: "Vergi / harç", id: "tax_fee", isSystem: true },
  { code: "other", displayName: "Diğer", id: "other", isSystem: true },
];

const paymentLabels: Readonly<Record<PaymentMethod, string>> = {
  bank_transfer: "Banka",
  cash: "Nakit",
  credit_card: "Kredi kartı",
  other: "Diğer",
};

const documentLabels: Readonly<Record<DocumentType, string>> = {
  invoice: "Fatura",
  none: "Belge yok",
  other: "Diğer belge",
  receipt: "Fiş",
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

function editableMoney(value: string): string {
  const [integer, fraction] = value.split(".", 2);
  if (fraction === undefined) return integer;
  const significantFraction = fraction.replace(/0+$/u, "");
  return significantFraction === "" ? integer : `${integer}.${significantFraction}`;
}

function canonicalMoneyInput(value: string): string {
  return value.trim().replace(",", ".");
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

function liveTotal(netAmount: string, vatAmount: string): string {
  try {
    const net = canonicalMoneyInput(netAmount || "0");
    const vat = canonicalMoneyInput(vatAmount || "0");
    return formatMoney(new Decimal(net).plus(vat).toFixed(4));
  } catch {
    return "—";
  }
}

function emptyDraft(canUseAccountLedger = true): ExpenseDraft {
  return {
    category: "other",
    creditCardId: "",
    description: "",
    documentNumber: "",
    documentType: "none",
    incurredOn: istanbulToday(),
    installmentCount: "1",
    netAmount: "",
    note: "",
    paymentMethod: canUseAccountLedger ? "bank_transfer" : "other",
    projectId: "",
    sourceAccountId: "",
    vatAmount: "0",
    vendorName: "",
  };
}

function emptyRecurringDraft(): RecurringDraft {
  return { endsOn: "", frequency: "monthly", nextDueOn: istanbulToday() };
}

function draftFromExpense(expense: ExpenseDto, copy: boolean): ExpenseDraft {
  return {
    category: expense.category,
    creditCardId: expense.creditCardId ?? "",
    description: expense.description,
    documentNumber: expense.documentNumber ?? "",
    documentType: expense.documentType,
    incurredOn: copy ? istanbulToday() : expense.incurredOn,
    installmentCount: String(expense.installmentCount),
    netAmount: editableMoney(expense.netAmount),
    note: expense.note ?? "",
    paymentMethod: expense.paymentMethod,
    projectId: expense.projectId ?? "",
    sourceAccountId: expense.sourceAccountId ?? "",
    vatAmount: editableMoney(expense.vatAmount),
    vendorName: expense.vendorName ?? "",
  };
}

function draftFromRecurringPlan(plan: RecurringExpensePlanDto): ExpenseDraft {
  return {
    category: plan.category,
    creditCardId: plan.creditCardId ?? "",
    description: plan.description,
    documentNumber: "",
    documentType: "none",
    incurredOn: plan.nextDueOn,
    installmentCount: "1",
    netAmount: editableMoney(plan.netAmount),
    note: plan.note ?? "",
    paymentMethod: plan.paymentMethod,
    projectId: plan.projectId ?? "",
    sourceAccountId: plan.sourceAccountId ?? "",
    vatAmount: editableMoney(plan.vatAmount),
    vendorName: plan.vendorName ?? "",
  };
}

function recurringDraftFromPlan(plan: RecurringExpensePlanDto): RecurringDraft {
  return {
    endsOn: plan.endsOn ?? "",
    frequency: plan.frequency,
    nextDueOn: plan.nextDueOn,
  };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function expenseBody(draft: ExpenseDraft) {
  return {
    category: draft.category,
    creditCardId:
      draft.paymentMethod === "credit_card" ? nullable(draft.creditCardId) : null,
    description: draft.description.trim(),
    documentNumber:
      draft.documentType === "none" ? null : nullable(draft.documentNumber),
    documentType: draft.documentType,
    incurredOn: draft.incurredOn,
    installmentCount:
      draft.paymentMethod === "credit_card"
        ? Number(draft.installmentCount)
        : 1,
    netAmount: canonicalMoneyInput(draft.netAmount),
    note: nullable(draft.note),
    paymentMethod: draft.paymentMethod,
    projectId: nullable(draft.projectId),
    sourceAccountId:
      draft.paymentMethod === "cash" || draft.paymentMethod === "bank_transfer"
        ? nullable(draft.sourceAccountId)
        : null,
    vatAmount: canonicalMoneyInput(draft.vatAmount),
    vendorName: nullable(draft.vendorName),
  };
}

function recurringPlanBody(draft: ExpenseDraft, recurrence: RecurringDraft) {
  return {
    category: draft.category,
    creditCardId:
      draft.paymentMethod === "credit_card" ? nullable(draft.creditCardId) : null,
    description: draft.description.trim(),
    endsOn: nullable(recurrence.endsOn),
    frequency: recurrence.frequency,
    netAmount: canonicalMoneyInput(draft.netAmount),
    note: nullable(draft.note),
    paymentMethod: draft.paymentMethod,
    projectId: nullable(draft.projectId),
    sourceAccountId:
      draft.paymentMethod === "cash" || draft.paymentMethod === "bank_transfer"
        ? nullable(draft.sourceAccountId)
        : null,
    vatAmount: canonicalMoneyInput(draft.vatAmount),
    vendorName: nullable(draft.vendorName),
  };
}

function canonicalSearch(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}

type ExpensesWorkspaceProps = Readonly<{
  capabilities?: Readonly<{
    canReadAudit: boolean;
    canReadAccounts?: boolean;
    canReverseExpenses: boolean;
    canWriteAccounts?: boolean;
    canWriteExpenses: boolean;
  }>;
  initialCreate?: boolean;
}>;

const fullExpenseCapabilities: NonNullable<ExpensesWorkspaceProps["capabilities"]> = {
  canReadAudit: true,
  canReadAccounts: true,
  canReverseExpenses: true,
  canWriteAccounts: true,
  canWriteExpenses: true,
};

export function ExpensesWorkspace({
  capabilities = fullExpenseCapabilities,
  initialCreate = false,
}: ExpensesWorkspaceProps = {}) {
  const router = useRouter();
  const [projects, setProjects] = useState<readonly ProjectDto[]>([]);
  const [cards, setCards] = useState<readonly CreditCardDto[]>([]);
  const [accounts, setAccounts] = useState<readonly FinanceAccountDto[]>([]);
  const [categories, setCategories] = useState<readonly ExpenseCategoryDto[]>(
    fallbackCategoryDefinitions,
  );
  const [expenses, setExpenses] = useState<readonly ExpenseDto[]>([]);
  const [recurringPlans, setRecurringPlans] = useState<
    readonly RecurringExpensePlanDto[]
  >([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestRevision, setRequestRevision] = useState(0);
  const [editorMode, setEditorMode] = useState<EditorMode>(
    initialCreate && capabilities.canWriteExpenses ? "create" : null,
  );
  const [editingExpense, setEditingExpense] = useState<ExpenseDto | null>(null);
  const [editingPlan, setEditingPlan] = useState<RecurringExpensePlanDto | null>(
    null,
  );
  const [recordKind, setRecordKind] = useState<ExpenseRecordKind>("one_time");
  const canUseAccountLedger =
    capabilities.canReadAccounts === true && capabilities.canWriteAccounts === true;
  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    emptyDraft(canUseAccountLedger),
  );
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraft>(
    emptyRecurringDraft,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categorySaveState, setCategorySaveState] = useState<SaveState>("idle");
  const [pendingCategoryCode, setPendingCategoryCode] = useState<string | null>(
    null,
  );
  const [monthFilter, setMonthFilter] = useState(currentIstanbulMonth());
  const [projectFilter, setProjectFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentMethod | "all">("all");
  const [query, setQuery] = useState("");
  const [planActionId, setPlanActionId] = useState<string | null>(null);
  const [planActionError, setPlanActionError] = useState<string | null>(null);
  const editorTitleRef = useRef<HTMLHeadingElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const operationRef = useRef<Readonly<{ fingerprint: string; key: string }> | null>(
    null,
  );
  const categoryOperationRef = useRef<
    Readonly<{ fingerprint: string; key: string }> | null
  >(null);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    // The production pool deliberately has two connections. Keep these reads
    // sequential so adding the finance workspace cannot exhaust it.
    const projectsResponse = await fetch("/api/projects", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (projectsResponse.status === 401) return redirectToLogin();
    if (!projectsResponse.ok) throw new Error("Projects are unavailable.");
    const projectPayload = (await projectsResponse.json()) as {
      projects?: ProjectDto[];
    };

    const cardsResponse = await fetch("/api/finance/cards", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (cardsResponse.status === 401) return redirectToLogin();
    if (!cardsResponse.ok) throw new Error("Cards are unavailable.");
    const cardPayload = (await cardsResponse.json()) as { cards?: CreditCardDto[] };

    let accountPayload: { accounts?: FinanceAccountDto[] } = { accounts: [] };
    if (capabilities.canReadAccounts) {
      const accountsResponse = await fetch("/api/finance/accounts", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      if (accountsResponse.status === 401) return redirectToLogin();
      if (!accountsResponse.ok) throw new Error("Accounts are unavailable.");
      accountPayload = (await accountsResponse.json()) as {
        accounts?: FinanceAccountDto[];
      };
    }

    const categoriesResponse = await fetch("/api/finance/expense-categories", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (categoriesResponse.status === 401) return redirectToLogin();
    if (!categoriesResponse.ok) throw new Error("Categories are unavailable.");
    const categoryPayload = (await categoriesResponse.json()) as {
      categories?: ExpenseCategoryDto[];
    };

    const expensesResponse = await fetch("/api/finance/expenses", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (expensesResponse.status === 401) return redirectToLogin();
    if (!expensesResponse.ok) throw new Error("Expenses are unavailable.");
    const expensePayload = (await expensesResponse.json()) as {
      expenses?: ExpenseDto[];
    };

    const recurringResponse = await fetch("/api/finance/recurring-expenses", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (recurringResponse.status === 401) return redirectToLogin();
    if (!recurringResponse.ok) {
      throw new Error("Recurring expense plans are unavailable.");
    }
    const recurringPayload = (await recurringResponse.json()) as {
      plans?: RecurringExpensePlanDto[];
    };

    if (
      !Array.isArray(projectPayload.projects) ||
      !Array.isArray(cardPayload.cards) ||
      !Array.isArray(accountPayload.accounts) ||
      !Array.isArray(categoryPayload.categories) ||
      !Array.isArray(expensePayload.expenses) ||
      !Array.isArray(recurringPayload.plans)
    ) {
      throw new Error("Expense workspace response is invalid.");
    }
    setProjects(projectPayload.projects);
    setCards(cardPayload.cards);
    setAccounts(accountPayload.accounts);
    setCategories(categoryPayload.categories);
    setExpenses(expensePayload.expenses);
    setRecurringPlans(recurringPayload.plans);
    setLoadState("ready");
  }, [capabilities.canReadAccounts]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => loadWorkspace(controller.signal))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProjects([]);
        setCards([]);
        setAccounts([]);
        setCategories(fallbackCategoryDefinitions);
        setExpenses([]);
        setRecurringPlans([]);
        setLoadState("error");
      });
    return () => controller.abort();
  }, [loadWorkspace, requestRevision]);

  useEffect(() => {
    if (editorMode === null) return;
    const title = editorTitleRef.current;
    title?.scrollIntoView?.({ block: "start" });
    title?.focus({ preventScroll: true });
  }, [editorMode]);

  const activeCards = useMemo(
    () => cards.filter((card) => card.status === "active"),
    [cards],
  );

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status === "active"),
    [accounts],
  );

  const categoryLabels = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [category.code, category.displayName]),
      ) as Readonly<Record<string, string>>,
    [categories],
  );

  const visibleExpenses = useMemo(() => {
    const search = canonicalSearch(query);
    return expenses.filter((expense) => {
      const matchesMonth =
        monthFilter === "" || expense.incurredOn.slice(0, 7) === monthFilter;
      const matchesProject =
        projectFilter === "all" ||
        (projectFilter === "unassigned"
          ? expense.projectId === null
          : expense.projectId === projectFilter);
      const matchesPayment =
        paymentFilter === "all" || expense.paymentMethod === paymentFilter;
      const matchesSearch =
        search === "" ||
        canonicalSearch(expense.description).includes(search) ||
        canonicalSearch(expense.vendorName ?? "").includes(search) ||
        canonicalSearch(expense.projectName ?? "").includes(search) ||
        canonicalSearch(expense.documentNumber ?? "").includes(search);
      return matchesMonth && matchesProject && matchesPayment && matchesSearch;
    });
  }, [expenses, monthFilter, paymentFilter, projectFilter, query]);

  const activeVisibleExpenses = visibleExpenses.filter(
    (expense) => expense.status === "active",
  );
  const summary = {
    card: sumMoney(
      activeVisibleExpenses
        .filter((expense) => expense.paymentMethod === "credit_card")
        .map((expense) => expense.totalAmount),
    ),
    direct: sumMoney(
      activeVisibleExpenses
        .filter(
          (expense) =>
            expense.paymentMethod === "bank_transfer" ||
            expense.paymentMethod === "cash",
        )
        .map((expense) => expense.totalAmount),
    ),
    total: sumMoney(activeVisibleExpenses.map((expense) => expense.totalAmount)),
    vat: sumMoney(activeVisibleExpenses.map((expense) => expense.vatAmount)),
  };

  function updateDraft(next: Partial<ExpenseDraft>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function updateRecurringDraft(next: Partial<RecurringDraft>): void {
    setRecurringDraft((current) => ({ ...current, ...next }));
  }

  function openCreate(): void {
    const nextDraft = emptyDraft(canUseAccountLedger);
    setDraft(
      pendingCategoryCode === null
        ? nextDraft
        : { ...nextDraft, category: pendingCategoryCode },
    );
    setPendingCategoryCode(null);
    setEditingExpense(null);
    setEditingPlan(null);
    setRecordKind("one_time");
    setRecurringDraft(emptyRecurringDraft());
    setEditorMode("create");
    setFormError(null);
    setPlanActionError(null);
    operationRef.current = null;
  }

  function openEdit(expense: ExpenseDto): void {
    setDraft(draftFromExpense(expense, false));
    setEditingExpense(expense);
    setEditingPlan(null);
    setRecordKind("one_time");
    setEditorMode("edit");
    setFormError(null);
    operationRef.current = null;
  }

  function openCopy(expense: ExpenseDto): void {
    const copied = draftFromExpense(expense, true);
    setDraft({
      ...copied,
      creditCardId:
        copied.paymentMethod === "credit_card" &&
        !activeCards.some((card) => card.id === copied.creditCardId)
          ? ""
          : copied.creditCardId,
      sourceAccountId:
        (copied.paymentMethod === "cash" || copied.paymentMethod === "bank_transfer") &&
        (!canUseAccountLedger ||
          !activeAccounts.some(
            (account) =>
              account.id === copied.sourceAccountId &&
              account.accountType ===
                (copied.paymentMethod === "cash" ? "cash" : "bank"),
          ))
          ? ""
          : copied.sourceAccountId,
    });
    setEditingExpense(null);
    setEditingPlan(null);
    setRecordKind("one_time");
    setRecurringDraft(emptyRecurringDraft());
    setEditorMode("copy");
    setFormError(null);
    operationRef.current = null;
  }

  function openEditPlan(plan: RecurringExpensePlanDto): void {
    setDraft(draftFromRecurringPlan(plan));
    setRecurringDraft(recurringDraftFromPlan(plan));
    setEditingExpense(null);
    setEditingPlan(plan);
    setRecordKind("recurring");
    setEditorMode("edit");
    setFormError(null);
    setPlanActionError(null);
    operationRef.current = null;
  }

  function closeEditor(): void {
    setEditorMode(null);
    setEditingExpense(null);
    setEditingPlan(null);
    setSaveState("idle");
    setFormError(null);
    operationRef.current = null;
    if (initialCreate) {
      router.replace("/finans/giderler", { scroll: false });
    }
  }

  function closeCategoryEditor(restoreFocus: boolean): void {
    setCategoryEditorOpen(false);
    setCategoryError(null);
    categoryOperationRef.current = null;
    if (restoreFocus) {
      window.setTimeout(() => categoryTriggerRef.current?.focus(), 0);
    }
  }

  async function submitCategory(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const displayName = categoryName.trim();
    if (displayName === "") {
      setCategoryError("Kategori adı zorunludur.");
      return;
    }
    if (
      categoryOperationRef.current === null ||
      categoryOperationRef.current.fingerprint !== displayName
    ) {
      categoryOperationRef.current = {
        fingerprint: displayName,
        key: globalThis.crypto.randomUUID(),
      };
    }
    setCategorySaveState("saving");
    setCategoryError(null);
    try {
      const response = await fetch("/api/finance/expense-categories", {
        body: JSON.stringify({
          clientOperationKey: categoryOperationRef.current.key,
          displayName,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        category?: ExpenseCategoryDto;
        status?: string;
      };
      if (!response.ok || payload.category === undefined) {
        setCategoryError(
          payload.status === "category_already_exists"
            ? "Bu adla bir gider kategorisi zaten var."
            : payload.status === "validation_error"
              ? "Kategori adını kontrol edin."
              : "Kategori eklenemedi. Lütfen yeniden deneyin.",
        );
        setCategorySaveState("idle");
        return;
      }
      const saved = payload.category;
      setCategories((current) =>
        current.some((category) => category.id === saved.id)
          ? current
          : [...current, saved].sort((left, right) => {
              if (left.isSystem !== right.isSystem) return left.isSystem ? -1 : 1;
              return left.displayName.localeCompare(right.displayName, "tr-TR");
            }),
      );
      if (editorMode === null) {
        setPendingCategoryCode(saved.code);
      } else {
        setDraft((current) => ({ ...current, category: saved.code }));
      }
      setAnnouncement(`${saved.displayName} gider kategorisi eklendi.`);
      setCategoryName("");
      setCategorySaveState("idle");
      closeCategoryEditor(true);
    } catch {
      setCategoryError("Kategori eklenemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setCategorySaveState("idle");
    }
  }

  async function saveRecurringPlan(): Promise<void> {
    const body = recurringPlanBody(draft, recurringDraft);
    if (body.description === "") {
      setFormError("Açıklama zorunludur.");
      return;
    }
    if (
      body.netAmount === "" ||
      body.vatAmount === "" ||
      recurringDraft.nextDueOn === ""
    ) {
      setFormError("İlk vade ile net ve KDV tutarlarını girin.");
      return;
    }
    if (
      recurringDraft.endsOn !== "" &&
      recurringDraft.endsOn < recurringDraft.nextDueOn
    ) {
      setFormError("Bitiş tarihi sıradaki vadeden önce olamaz.");
      return;
    }
    if (body.paymentMethod === "credit_card" && body.creditCardId === null) {
      setFormError("Tekrarlayan kart gideri için kart seçin.");
      return;
    }
    if (
      (body.paymentMethod === "cash" || body.paymentMethod === "bank_transfer") &&
      body.sourceAccountId === null
    ) {
      setFormError(
        body.paymentMethod === "cash"
          ? "Planın ödeneceği kasayı seçin."
          : "Planın ödeneceği banka hesabını seçin.",
      );
      return;
    }

    const existing = editorMode === "edit" ? editingPlan : null;
    setSaveState("saving");
    setFormError(null);
    const fingerprint = JSON.stringify({
      ...body,
      nextDueOn: recurringDraft.nextDueOn,
    });
    if (
      existing === null &&
      (operationRef.current === null ||
        operationRef.current.fingerprint !== fingerprint)
    ) {
      operationRef.current = {
        fingerprint,
        key: globalThis.crypto.randomUUID(),
      };
    }
    const requestBody =
      existing === null
        ? {
            ...body,
            clientOperationKey: operationRef.current?.key,
            firstDueOn: recurringDraft.nextDueOn,
          }
        : {
            ...body,
            nextDueOn: recurringDraft.nextDueOn,
            status: existing.status,
            version: existing.version,
          };

    try {
      const response = await fetch(
        existing === null
          ? "/api/finance/recurring-expenses"
          : `/api/finance/recurring-expenses/${existing.id}`,
        {
          body: JSON.stringify(requestBody),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: existing === null ? "POST" : "PATCH",
        },
      );
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        plan?: RecurringExpensePlanDto;
        status?: string;
      };
      if (!response.ok || payload.plan === undefined) {
        const message = {
          credit_card_inactive: "Seçili kart pasif. Aktif bir kart seçin.",
          finance_account_inactive:
            "Seçili kasa veya banka hesabı pasif. Aktif bir hesap seçin.",
          finance_account_not_found:
            "Seçili kasa veya banka hesabı artık bulunamıyor.",
          finance_account_type_mismatch:
            "Nakit planı için kasa, banka planı için banka hesabı seçin.",
          idempotency_conflict:
            "Bu kayıt isteği daha önce farklı içerikle kullanıldı.",
          version_conflict:
            "Plan başka bir işlemde değişti. Listeyi yenileyip tekrar deneyin.",
        }[payload.status ?? ""];
        setFormError(
          payload.status === "validation_error"
            ? "Vade, tekrar sıklığı, tutar ve ödeme alanlarını kontrol edin."
            : message ?? "Tekrarlayan gider planı kaydedilemedi.",
        );
        setSaveState("idle");
        return;
      }
      const saved = payload.plan;
      setRecurringPlans((current) =>
        existing === null
          ? [saved, ...current]
          : current.map((plan) => (plan.id === saved.id ? saved : plan)),
      );
      setAnnouncement(
        existing === null
          ? `${saved.description} tekrarlayan gider planı oluşturuldu.`
          : `${saved.description} planı güncellendi.`,
      );
      operationRef.current = null;
      closeEditor();
    } catch {
      setFormError(
        "Tekrarlayan gider planı kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.",
      );
      setSaveState("idle");
    }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (recordKind === "recurring") {
      await saveRecurringPlan();
      return;
    }
    const body = expenseBody(draft);
    if (body.description === "") {
      setFormError("Açıklama zorunludur.");
      return;
    }
    if (body.netAmount === "" || body.vatAmount === "") {
      setFormError("Net ve KDV tutarlarını girin.");
      return;
    }
    if (body.paymentMethod === "credit_card" && body.creditCardId === null) {
      setFormError("Kredi kartıyla ödenen gider için kart seçin.");
      return;
    }
    if (
      (body.paymentMethod === "cash" || body.paymentMethod === "bank_transfer") &&
      body.sourceAccountId === null
    ) {
      setFormError(
        body.paymentMethod === "cash"
          ? "Nakit giderin düşeceği kasayı seçin."
          : "Banka giderinin düşeceği hesabı seçin.",
      );
      return;
    }

    const existing = editorMode === "edit" ? editingExpense : null;
    setSaveState("saving");
    setFormError(null);
    const fingerprint = JSON.stringify(body);
    if (
      existing === null &&
      (operationRef.current === null ||
        operationRef.current.fingerprint !== fingerprint)
    ) {
      operationRef.current = {
        fingerprint,
        key: globalThis.crypto.randomUUID(),
      };
    }
    const requestBody =
      existing === null
        ? { ...body, clientOperationKey: operationRef.current?.key }
        : {
            ...body,
            status: existing.status,
            version: existing.version,
            voidReason: existing.voidReason ?? null,
          };
    try {
      const response = await fetch(
        existing === null
          ? "/api/finance/expenses"
          : `/api/finance/expenses/${existing.id}`,
        {
          body: JSON.stringify(requestBody),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: existing === null ? "POST" : "PATCH",
        },
      );
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        expense?: ExpenseDto;
        status?: string;
      };
      if (!response.ok || payload.expense === undefined) {
        const conflictMessage = {
          credit_card_inactive:
            "Seçili kart pasif. Aktif bir kart seçin veya ödeme yöntemini değiştirin.",
          finance_account_inactive:
            "Seçili kasa veya banka hesabı pasif. Aktif bir hesap seçin.",
          finance_account_not_found:
            "Seçili kasa veya banka hesabı artık bulunamıyor.",
          finance_account_type_mismatch:
            "Nakit ödeme için kasa, banka ödemesi için banka hesabı seçin.",
          finance_transaction_before_account_opening:
            "Gider tarihi seçili hesabın açılış tarihinden önce olamaz.",
          finance_transaction_future_date:
            "Nakit veya banka hesabından çıkan gider gelecekteki bir tarihe kaydedilemez.",
          expense_already_voided: "İptal edilmiş gider artık düzenlenemez.",
          expense_plan_locked:
            "Bu gider ödeme planına işlendiği için kart, taksit veya tutar bilgileri değiştirilemez.",
          version_conflict:
            "Gider başka bir işlemde değişti. Listeyi yenileyip tekrar deneyin.",
        }[payload.status ?? ""];
        setFormError(
          response.status === 409
            ? conflictMessage ?? "Gider kaydedilemedi. Listeyi yenileyip tekrar deneyin."
            : payload.status === "validation_error"
              ? "Tarih, tutar, ödeme yöntemi ve kart alanlarını kontrol edin."
              : "Gider kaydedilemedi. Lütfen yeniden deneyin.",
        );
        setSaveState("idle");
        return;
      }
      const saved = payload.expense;
      setExpenses((current) =>
        existing === null
          ? [saved, ...current]
          : current.map((expense) => (expense.id === saved.id ? saved : expense)),
      );
      setMonthFilter(saved.incurredOn.slice(0, 7));
      setProjectFilter("all");
      setPaymentFilter("all");
      setQuery("");
      setAnnouncement(
        existing === null
          ? `${saved.description} gideri kaydedildi.`
          : `${saved.description} gideri güncellendi.`,
      );
      operationRef.current = null;
      closeEditor();
    } catch {
      setFormError("Gider kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
      setSaveState("idle");
    }
  }

  function recurringUpdateBody(
    plan: RecurringExpensePlanDto,
    status: RecurringStatus,
  ) {
    return {
      category: plan.category,
      creditCardId: plan.creditCardId,
      description: plan.description,
      endsOn: plan.endsOn,
      frequency: plan.frequency,
      netAmount: plan.netAmount,
      nextDueOn: plan.nextDueOn,
      note: plan.note,
      paymentMethod: plan.paymentMethod,
      projectId: plan.projectId,
      sourceAccountId: plan.sourceAccountId,
      status,
      vatAmount: plan.vatAmount,
      vendorName: plan.vendorName,
      version: plan.version,
    };
  }

  async function changePlanStatus(
    plan: RecurringExpensePlanDto,
    status: RecurringStatus,
  ): Promise<void> {
    setPlanActionId(plan.id);
    setPlanActionError(null);
    try {
      const response = await fetch(`/api/finance/recurring-expenses/${plan.id}`, {
        body: JSON.stringify(recurringUpdateBody(plan, status)),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        plan?: RecurringExpensePlanDto;
        status?: string;
      };
      if (!response.ok || payload.plan === undefined) {
        setPlanActionError(
          payload.status === "version_conflict"
            ? "Plan başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin."
            : "Planın durumu değiştirilemedi.",
        );
        return;
      }
      const savedPlan = payload.plan;
      setRecurringPlans((current) =>
        current.map((item) => (item.id === savedPlan.id ? savedPlan : item)),
      );
      setAnnouncement(
        status === "paused"
          ? `${plan.description} planı pasife alındı.`
          : `${plan.description} planı etkinleştirildi.`,
      );
    } catch {
      setPlanActionError("Planın durumu değiştirilemedi. Bağlantıyı kontrol edin.");
    } finally {
      setPlanActionId(null);
    }
  }

  async function realizePlan(plan: RecurringExpensePlanDto): Promise<void> {
    setPlanActionId(plan.id);
    setPlanActionError(null);
    try {
      const response = await fetch(
        `/api/finance/recurring-expenses/${plan.id}/realize`,
        {
          body: JSON.stringify({
            version: plan.version,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (response.status === 401) return redirectToLogin();
      const payload = (await response.json()) as {
        expense?: ExpenseDto;
        plan?: RecurringExpensePlanDto;
        status?: string;
      };
      if (!response.ok || payload.expense === undefined || payload.plan === undefined) {
        const message = {
          finance_account_inactive:
            "Planın kasası veya banka hesabı pasif. Önce planı düzenleyin.",
          finance_account_not_found:
            "Planın kasası veya banka hesabı artık bulunamıyor.",
          finance_transaction_before_account_opening:
            "Vade tarihi seçili hesabın açılış tarihinden önce.",
          not_due: "Bu planın vadesi henüz gelmedi.",
          plan_paused: "Pasif plan gider olarak işlenemez.",
          version_conflict:
            "Plan başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin.",
        }[payload.status ?? ""];
        setPlanActionError(message ?? "Plan gider olarak işlenemedi.");
        return;
      }
      const savedExpense = payload.expense;
      const savedPlan = payload.plan;
      setRecurringPlans((current) =>
        current.map((item) => (item.id === savedPlan.id ? savedPlan : item)),
      );
      setExpenses((current) => [savedExpense, ...current]);
      setAnnouncement(
        `${plan.description} gider olarak işlendi. Sıradaki vade ${formatDate(savedPlan.nextDueOn)}.`,
      );
    } catch {
      setPlanActionError("Plan gider olarak işlenemedi. Bağlantıyı kontrol edin.");
    } finally {
      setPlanActionId(null);
    }
  }

  const today = istanbulToday();

  return (
    <section className="expense-workspace" aria-labelledby="expense-ledger-title">
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <div className="expense-command-bar">
        <div>
          <p className="section-kicker">Finans / Gider defteri</p>
          <h2 id="expense-ledger-title">Giderler</h2>
          <p>Ödemeleri iş hattı, KDV ve ödeme kaynağıyla birlikte kaydedin.</p>
        </div>
        {capabilities.canWriteExpenses ? (
          <div className="expense-command-actions">
            <button
              aria-controls="expense-category-editor"
              aria-expanded={categoryEditorOpen}
              className="text-action"
              ref={categoryTriggerRef}
              type="button"
              onClick={() => {
                if (categoryEditorOpen) closeCategoryEditor(false);
                else {
                  setCategoryEditorOpen(true);
                  setCategoryError(null);
                }
              }}
            >
              + Kategori ekle
            </button>
            <button className="primary-action" type="button" onClick={openCreate}>
              + Gider ekle
            </button>
          </div>
        ) : null}
      </div>

      <section className="finance-summary expense-summary" aria-label="Gider özeti">
        {[
          ["Dönem toplamı", summary.total],
          ["KDV", summary.vat],
          ["Kart harcaması", summary.card],
          ["Nakit / banka", summary.direct],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{loadState === "ready" ? formatMoney(value) : "—"}</strong>
          </div>
        ))}
      </section>

      {categoryEditorOpen ? (
        <form
          className="expense-category-entry"
          id="expense-category-editor"
          onSubmit={(event) => void submitCategory(event)}
        >
          <label>
            <span>Yeni gider kategorisi</span>
            <input
              autoFocus
              maxLength={191}
              placeholder="Örn. Eğitim materyali"
              required
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
          </label>
          <div className="expense-category-actions">
            <button
              className="text-action"
              disabled={categorySaveState === "saving"}
              type="button"
              onClick={() => closeCategoryEditor(true)}
            >
              Vazgeç
            </button>
            <button
              className="primary-action"
              disabled={categorySaveState === "saving"}
              type="submit"
            >
              {categorySaveState === "saving" ? "Ekleniyor…" : "Kategoriyi ekle"}
            </button>
          </div>
          {categoryError === null ? null : (
            <p className="entry-error" role="alert">{categoryError}</p>
          )}
        </form>
      ) : null}

      {editorMode !== null ? (
        <section className="finance-entry expense-entry" aria-labelledby="expense-form-title">
          <div className="finance-entry-intro">
            <p className="section-kicker">
              {recordKind === "recurring"
                ? editingPlan === null
                  ? "Yeni ödeme planı"
                  : "Plan düzeltme"
                : editorMode === "edit"
                  ? "Kayıt düzeltme"
                  : "Yeni gider"}
            </p>
            <h3 id="expense-form-title" ref={editorTitleRef} tabIndex={-1}>
              {recordKind === "recurring"
                ? editingPlan === null
                  ? "Tekrarlayan gider planı"
                  : "Tekrarlayan planı düzenle"
                : editorMode === "edit"
                  ? "Gideri düzenle"
                  : editorMode === "copy"
                    ? "Gider kopyası"
                    : "Gider ekle"}
            </h3>
            <p>
              {recordKind === "recurring"
                ? "Plan oluşturmak hesabınızdan para düşmez. Vadesi geldiğinde gideri siz işlersiniz."
                : "Belge görseli gerekmez. Net ve KDV tutarları ayrı saklanır; toplam otomatik hesaplanır."}
            </p>
            <dl className="expense-live-total">
              <dt>
                {recordKind === "recurring" ? "Her dönem planlanan" : "Ödenecek toplam"}
              </dt>
              <dd>{liveTotal(draft.netAmount, draft.vatAmount)}</dd>
            </dl>
          </div>

          <form className="finance-form expense-form" onSubmit={(event) => void submitExpense(event)}>
            <fieldset className="finance-form-wide expense-record-kind">
              <legend>Kayıt türü</legend>
              <label>
                <input
                  checked={recordKind === "one_time"}
                  disabled={editorMode === "edit"}
                  name="expense-record-kind"
                  onChange={() => setRecordKind("one_time")}
                  type="radio"
                  value="one_time"
                />
                <span>Tek seferlik gider</span>
              </label>
              <label>
                <input
                  checked={recordKind === "recurring"}
                  disabled={editorMode === "edit"}
                  name="expense-record-kind"
                  onChange={() => {
                    setRecordKind("recurring");
                    setRecurringDraft((current) => ({
                      ...current,
                      nextDueOn: draft.incurredOn,
                    }));
                  }}
                  type="radio"
                  value="recurring"
                />
                <span>Tekrarlayan gider planı</span>
              </label>
            </fieldset>
            <label>
              <span>
                {recordKind === "recurring"
                  ? editingPlan === null
                    ? "İlk vade"
                    : "Sıradaki vade"
                  : "Gider tarihi"}
              </span>
              <input
                max={
                  recordKind === "one_time" &&
                  (draft.paymentMethod === "cash" ||
                    draft.paymentMethod === "bank_transfer")
                    ? istanbulToday()
                    : "9999-12-31"
                }
                min="1000-01-01"
                required
                type="date"
                value={
                  recordKind === "recurring"
                    ? recurringDraft.nextDueOn
                    : draft.incurredOn
                }
                onChange={(event) =>
                  recordKind === "recurring"
                    ? updateRecurringDraft({ nextDueOn: event.target.value })
                    : updateDraft({ incurredOn: event.target.value })
                }
              />
            </label>
            {recordKind === "recurring" ? (
              <>
                <label>
                  <span>Tekrar</span>
                  <select
                    value={recurringDraft.frequency}
                    onChange={(event) =>
                      updateRecurringDraft({
                        frequency: event.target.value as RecurringFrequency,
                      })
                    }
                  >
                    <option value="weekly">Her hafta</option>
                    <option value="monthly">Her ay</option>
                  </select>
                </label>
                <label>
                  <span>Bitiş tarihi</span>
                  <input
                    min={recurringDraft.nextDueOn || "1000-01-01"}
                    type="date"
                    value={recurringDraft.endsOn}
                    onChange={(event) =>
                      updateRecurringDraft({ endsOn: event.target.value })
                    }
                  />
                  <small>Boş bırakırsanız siz pasife alana kadar sürer.</small>
                </label>
              </>
            ) : null}
            <label>
              <span>Proje / iş hattı</span>
              <select
                value={draft.projectId}
                onChange={(event) => updateDraft({ projectId: event.target.value })}
              >
                <option value="">Genel / projeye atanmadı</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.displayName} · {project.shortCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Kategori</span>
              <select
                value={draft.category}
                onChange={(event) =>
                  updateDraft({ category: event.target.value as ExpenseCategory })
                }
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.code}>
                    {category.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Firma / kişi</span>
              <input
                maxLength={191}
                placeholder="İsteğe bağlı"
                value={draft.vendorName}
                onChange={(event) => updateDraft({ vendorName: event.target.value })}
              />
            </label>
            <label className="finance-form-wide">
              <span>Açıklama</span>
              <input
                maxLength={191}
                required
                value={draft.description}
                onChange={(event) => updateDraft({ description: event.target.value })}
              />
            </label>
            <label>
              <span>Net tutar (₺)</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                required
                value={draft.netAmount}
                onChange={(event) => updateDraft({ netAmount: event.target.value })}
              />
            </label>
            <label>
              <span>KDV tutarı (₺)</span>
              <input
                inputMode="decimal"
                required
                value={draft.vatAmount}
                onChange={(event) => updateDraft({ vatAmount: event.target.value })}
              />
            </label>
            <label>
              <span>Ödeme yöntemi</span>
              <select
                value={draft.paymentMethod}
                onChange={(event) => {
                  const paymentMethod = event.target.value as PaymentMethod;
                  updateDraft({
                    creditCardId:
                      paymentMethod === "credit_card" ? draft.creditCardId : "",
                    installmentCount:
                      paymentMethod === "credit_card" ? draft.installmentCount : "1",
                    paymentMethod,
                    sourceAccountId: "",
                  });
                }}
              >
                {Object.entries(paymentLabels).map(([value, label]) => (
                  <option
                    disabled={
                      (value === "cash" || value === "bank_transfer") &&
                      !canUseAccountLedger
                    }
                    key={value}
                    value={value}
                  >
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.paymentMethod === "credit_card" ? (
              <>
                <label>
                  <span>Kredi kartı</span>
                  <select
                    required
                    value={draft.creditCardId}
                    onChange={(event) => updateDraft({ creditCardId: event.target.value })}
                  >
                    <option value="">Kart seçin</option>
                    {editorMode === "edit" &&
                    draft.creditCardId !== "" &&
                    !activeCards.some((card) => card.id === draft.creditCardId) ? (
                      <option value={draft.creditCardId}>
                        {editingExpense?.creditCardName ??
                          editingPlan?.creditCardName ??
                          "Mevcut kart"} (pasif)
                      </option>
                    ) : null}
                    {activeCards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.displayName}{card.lastFour === null ? "" : ` · •••• ${card.lastFour}`}
                      </option>
                    ))}
                  </select>
                </label>
                {recordKind === "one_time" ? (
                  <label>
                    <span>Taksit sayısı</span>
                    <input
                      max={36}
                      min={1}
                      required
                      type="number"
                      value={draft.installmentCount}
                      onChange={(event) => updateDraft({ installmentCount: event.target.value })}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            {draft.paymentMethod === "cash" ||
            draft.paymentMethod === "bank_transfer" ? (
              <label>
                <span>
                  {draft.paymentMethod === "cash"
                    ? "Ödemenin çıktığı kasa"
                    : "Ödemenin çıktığı banka hesabı"}
                </span>
                <select
                  disabled={!canUseAccountLedger}
                  required
                  value={draft.sourceAccountId}
                  onChange={(event) =>
                    updateDraft({ sourceAccountId: event.target.value })
                  }
                >
                  <option value="">Hesap seçin</option>
                  {editorMode === "edit" &&
                  draft.sourceAccountId !== "" &&
                  !activeAccounts.some(
                    (account) => account.id === draft.sourceAccountId,
                  ) ? (
                    <option value={draft.sourceAccountId}>
                      {editingExpense?.sourceAccountName ??
                        editingPlan?.sourceAccountName ??
                        "Mevcut hesap"} (pasif)
                    </option>
                  ) : null}
                  {activeAccounts
                    .filter(
                      (account) =>
                        account.accountType ===
                        (draft.paymentMethod === "cash" ? "cash" : "bank"),
                    )
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName}
                        {account.bankName === null ? "" : ` · ${account.bankName}`}
                      </option>
                    ))}
                </select>
                {!canUseAccountLedger ? (
                  <small>Kasa/banka okuma ve düzenleme yetkisi gereklidir.</small>
                ) : null}
              </label>
            ) : null}
            {recordKind === "one_time" ? (
              <>
                <label>
                  <span>Belge türü</span>
                  <select
                    value={draft.documentType}
                    onChange={(event) =>
                      updateDraft({ documentType: event.target.value as DocumentType })
                    }
                  >
                    {Object.entries(documentLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                {draft.documentType !== "none" ? (
                  <label>
                    <span>Belge numarası</span>
                    <input
                      maxLength={191}
                      placeholder="İsteğe bağlı"
                      value={draft.documentNumber}
                      onChange={(event) => updateDraft({ documentNumber: event.target.value })}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
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
            {formError === null ? null : (
              <p className="entry-error" role="alert">{formError}</p>
            )}
            <div className="finance-form-actions">
              <button className="text-action" disabled={saveState === "saving"} type="button" onClick={closeEditor}>
                Vazgeç
              </button>
              <button className="primary-action" disabled={saveState === "saving"} type="submit">
                {saveState === "saving"
                  ? "Kaydediliyor…"
                  : recordKind === "recurring"
                    ? "Planı kaydet"
                    : "Gideri kaydet"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section
        className="recurring-expense-register"
        aria-labelledby="recurring-expense-title"
      >
        <header className="recurring-expense-heading">
          <div>
            <p className="section-kicker">Ödeme ritmi</p>
            <h3 id="recurring-expense-title">Tekrarlayan gider planları</h3>
          </div>
          <p>
            {loadState === "ready"
              ? `${recurringPlans.filter((plan) => plan.status === "active").length} aktif plan`
              : "Planlar yükleniyor…"}
          </p>
        </header>
        {planActionError === null ? null : (
          <p className="recurring-expense-error" role="alert">
            {planActionError}
          </p>
        )}
        <ul className="recurring-expense-list">
          {recurringPlans.map((plan) => {
            const usesProtectedAccount =
              plan.paymentMethod === "cash" ||
              plan.paymentMethod === "bank_transfer";
            const accountActionBlocked =
              usesProtectedAccount && !canUseAccountLedger;
            const isDue = plan.status === "active" && plan.nextDueOn <= today;
            const hasEnded =
              plan.endsOn !== null && plan.nextDueOn > plan.endsOn;
            const paymentDetail =
              plan.creditCardName ?? plan.sourceAccountName ?? null;

            return (
              <li
                className={plan.status === "paused" ? "is-paused" : undefined}
                key={plan.id}
              >
                <div className="recurring-expense-identity">
                  <div>
                    <strong>{plan.description}</strong>
                    <small>
                      {categoryLabels[plan.category] ?? plan.category}
                      {plan.vendorName === null ? "" : ` · ${plan.vendorName}`}
                    </small>
                  </div>
                  <span
                    className={`recurring-expense-status is-${plan.status}`}
                  >
                    {hasEnded
                      ? "Süresi tamamlandı"
                      : plan.status === "active"
                        ? isDue
                          ? "Vadesi geldi"
                          : "Aktif"
                        : "Pasif"}
                  </span>
                </div>
                <dl className="recurring-expense-facts">
                  <div>
                    <dt>Sıradaki vade</dt>
                    <dd>{formatDate(plan.nextDueOn)}</dd>
                  </div>
                  <div>
                    <dt>Tekrar</dt>
                    <dd>{plan.frequency === "weekly" ? "Her hafta" : "Her ay"}</dd>
                  </div>
                  <div>
                    <dt>Dönem toplamı</dt>
                    <dd>{formatMoney(plan.totalAmount)}</dd>
                    <small>KDV {formatMoney(plan.vatAmount)}</small>
                  </div>
                </dl>
                <p className="recurring-expense-context">
                  {plan.projectName ?? "Genel / projesiz"}
                  {` · ${paymentLabels[plan.paymentMethod]}`}
                  {paymentDetail === null ? "" : ` · ${paymentDetail}`}
                  {plan.endsOn === null ? "" : ` · Bitiş ${formatDate(plan.endsOn)}`}
                </p>
                {capabilities.canWriteExpenses ? (
                  <div className="recurring-expense-actions">
                    <button
                      disabled={planActionId !== null || accountActionBlocked}
                      title={
                        accountActionBlocked
                          ? "Bu planı düzenlemek için kasa/banka yetkisi gerekir."
                          : undefined
                      }
                      type="button"
                      onClick={() => openEditPlan(plan)}
                    >
                      Düzenle
                    </button>
                    {plan.status === "active" ? (
                      <button
                        disabled={planActionId !== null || accountActionBlocked}
                        type="button"
                        onClick={() => void changePlanStatus(plan, "paused")}
                      >
                        Pasife al
                      </button>
                    ) : hasEnded ? null : (
                      <button
                        disabled={planActionId !== null || accountActionBlocked}
                        type="button"
                        onClick={() => void changePlanStatus(plan, "active")}
                      >
                        Etkinleştir
                      </button>
                    )}
                    {isDue ? (
                      <button
                        className="is-primary"
                        disabled={planActionId !== null || accountActionBlocked}
                        title={
                          accountActionBlocked
                            ? "Bu gideri işlemek için kasa/banka yetkisi gerekir."
                            : undefined
                        }
                        type="button"
                        onClick={() => void realizePlan(plan)}
                      >
                        {planActionId === plan.id ? "İşleniyor…" : "Gideri işle"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
          {recurringPlans.length === 0 ? (
            <li className="recurring-expense-empty">
              {loadState === "loading"
                ? "Tekrarlayan gider planları yükleniyor…"
                : "Henüz tekrarlayan gider planı yok."}
            </li>
          ) : null}
        </ul>
      </section>

      <div className="expense-toolbar" aria-label="Gider filtreleri">
        <label>
          <span>Dönem</span>
          <input
            aria-label="Gider dönemi"
            type="month"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
          />
        </label>
        <label>
          <span>Proje</span>
          <select
            aria-label="Gider proje filtresi"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">Tüm projeler</option>
            <option value="unassigned">Genel / projesiz</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Ödeme</span>
          <select
            aria-label="Gider ödeme filtresi"
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value as PaymentMethod | "all")}
          >
            <option value="all">Tüm yöntemler</option>
            {Object.entries(paymentLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="expense-search">
          <span>Ara</span>
          <input
            placeholder="Açıklama, firma veya proje"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {loadState === "error" ? (
        <div className="finance-workspace-message is-error" role="alert">
          <span>Gider kayıtlarına ulaşılamadı. Bağlantıyı kontrol edin.</span>
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

      {loadState === "error" ? null : <div className="finance-table-wrap expense-table-wrap">
        <table className="finance-table expense-table" aria-label="Gider kayıtları">
          <thead>
            <tr>
              <th scope="col">Tarih</th>
              <th scope="col">Gider</th>
              <th scope="col">Proje</th>
              <th scope="col">Ödeme</th>
              <th scope="col">Net</th>
              <th scope="col">KDV</th>
              <th scope="col">Toplam</th>
              <th scope="col">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {visibleExpenses.map((expense) => (
              <tr className={expense.status === "voided" ? "is-voided" : undefined} key={expense.id}>
                <td data-label="Tarih">{formatDate(expense.incurredOn)}</td>
                <td data-label="Gider">
                  <strong>{expense.description}</strong>
                  <small>
                    {categoryLabels[expense.category] ?? expense.category}
                    {expense.vendorName === null ? "" : ` · ${expense.vendorName}`}
                  </small>
                </td>
                <td data-label="Proje">
                  {expense.projectName ?? "Genel"}
                  {expense.projectShortCode === null ? "" : ` · ${expense.projectShortCode}`}
                </td>
                <td data-label="Ödeme">
                  {paymentLabels[expense.paymentMethod]}
                  {expense.creditCardName === null ? "" : ` · ${expense.creditCardName}`}
                  {expense.sourceAccountName == null
                    ? ""
                    : ` · ${expense.sourceAccountName}`}
                  {expense.installmentCount > 1 ? ` · ${expense.installmentCount} taksit` : ""}
                </td>
                <td data-label="Net">{formatMoney(expense.netAmount)}</td>
                <td data-label="KDV">{formatMoney(expense.vatAmount)}</td>
                <td data-label="Toplam">
                  <strong>{formatMoney(expense.totalAmount)}</strong>
                  {expense.status === "voided" ? <small>İptal edildi</small> : null}
                </td>
                <td data-label="İşlem">
                  <div className="expense-row-actions">
                    {capabilities.canWriteExpenses ? (
                      <>
                        <button
                          aria-label={`${expense.description} giderini düzenle`}
                          disabled={
                            expense.status === "voided" ||
                            ((expense.paymentMethod === "cash" ||
                              expense.paymentMethod === "bank_transfer") &&
                              !canUseAccountLedger)
                          }
                          type="button"
                          onClick={() => openEdit(expense)}
                        >
                          Düzenle
                        </button>
                        <button
                          aria-label={`${expense.description} giderini kopyala`}
                          type="button"
                          onClick={() => openCopy(expense)}
                        >
                          Kopyala
                        </button>
                      </>
                    ) : null}
                    <RecordLifecycleControls
                      actions={
                        capabilities.canReverseExpenses &&
                        expense.status === "active" &&
                        (!(
                          expense.paymentMethod === "cash" ||
                          expense.paymentMethod === "bank_transfer"
                        ) ||
                          canUseAccountLedger)
                          ? [{
                        description: "Gideri silmeden finansal toplamlardan çıkarır ve gerekçeli iz bırakır.",
                        id: "void",
                        label: "Geçersiz kıl",
                        request: {
                          endpoint: `/api/finance/expenses/${expense.id}`,
                          kind: "expense-void",
                          version: expense.version,
                        },
                        tone: "danger",
                            }]
                          : []
                      }
                      canReadHistory={capabilities.canReadAudit}
                      entityId={expense.id}
                      entityLabel={expense.description}
                      entityType="expense"
                      onSuccess={() => setRequestRevision((current) => current + 1)}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {visibleExpenses.length === 0 ? (
              <tr>
                <td className="empty-row" colSpan={8}>
                  {loadState === "loading"
                    ? "Gider kayıtları yükleniyor…"
                    : expenses.length === 0
                      ? "Henüz gider yok. İlk kaydı ekleyerek başlayın."
                      : "Filtrelerle eşleşen gider yok."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
