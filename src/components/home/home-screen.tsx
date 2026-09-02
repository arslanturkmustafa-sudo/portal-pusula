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
  code: string;
  contact: string;
  contactNote?: string | null;
  email?: string | null;
  fee: string;
  id: string;
  name: string;
  payment: string;
  phone?: string | null;
  status: string;
  tone: "active" | "inactive" | "late" | "paid" | "waiting";
  visit: string;
}>;

type StoredCustomer = Readonly<{
  contactNote: string | null;
  displayName: string;
  email: string | null;
  id: string;
  phone: string | null;
  shortCode: string;
  status: "active" | "inactive";
}>;

const sampleCustomers: readonly CustomerView[] = [
  {
    code: "MK-001",
    contact: "İletişim kaydı bekliyor",
    name: "Atlas Makina",
    id: "sample-1",
    visit: "3 Eylül",
    fee: "120.000 ₺",
    payment: "Ayın 5'i",
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
    payment: "Ayın 10'u",
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
    payment: "Ayın 15'i",
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
    payment: "Ayın 20'si",
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
    payment: "Ayın 25'i",
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

function storedCustomerView(customer: StoredCustomer): CustomerView {
  return {
    code: customer.shortCode,
    contact: customer.email ?? customer.phone ?? "İletişim bilgisi yok",
    contactNote: customer.contactNote,
    email: customer.email,
    fee: "—",
    id: customer.id,
    name: customer.displayName,
    payment: "—",
    phone: customer.phone,
    status: customer.status === "active" ? "Aktif" : "Pasif",
    tone: customer.status,
    visit: "Planlanmadı",
  };
}

function contractFeeLabel(contract: {
  monthlyFeeAmount: string;
  vatMode: "exempt" | "exclusive" | "inclusive";
}): string {
  const amount = new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2,
  }).format(Number(contract.monthlyFeeAmount));
  if (contract.vatMode === "exclusive") return `${amount} ₺ + KDV`;
  if (contract.vatMode === "inclusive") return `${amount} ₺ (KDV dahil)`;
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
  live?: boolean;
}>;

export function HomeScreen({ live = false }: HomeScreenProps) {
  const [customerRows, setCustomerRows] =
    useState<readonly CustomerView[]>(() => (live ? [] : sampleCustomers));
  const [dataState, setDataState] = useState<
    "error" | "live" | "loading" | "sample"
  >(live ? "loading" : "sample");
  const [filter, setFilter] = useState<"all" | "late">("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"error" | "idle" | "saving">("idle");

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();

    void fetch("/api/customers", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Customer list is unavailable.");
        return (await response.json()) as { customers?: StoredCustomer[] };
      })
      .then((payload) => {
        setCustomerRows((payload.customers ?? []).map(storedCustomerView));
        setDataState("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataState("error");
      });

    return () => controller.abort();
  }, [live]);

  const visibleCustomers = useMemo(() => {
    const canonicalQuery = query.trim().toLocaleLowerCase("tr-TR");
    return customerRows.filter((customer) => {
      const queryMatches =
        canonicalQuery.length === 0 ||
        customer.name.toLocaleLowerCase("tr-TR").includes(canonicalQuery) ||
        customer.code.toLocaleLowerCase("tr-TR").includes(canonicalQuery);
      const filterMatches = filter === "all" || customer.tone === "late";
      return queryMatches && filterMatches;
    });
  }, [customerRows, filter, query]);

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
                payment: `Ayın ${contract.paymentDay}. günü`,
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
    setSaveState("saving");

    try {
      const response = await fetch("/api/customers", {
        body: JSON.stringify({
          contactNote: fields.get("contactNote"),
          displayName: fields.get("displayName"),
          email: fields.get("email"),
          phone: fields.get("phone"),
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
      setFormOpen(false);
      form.reset();
    } catch {
      setSaveState("error");
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
        actions={(
          <button
            className="primary-action"
            type="button"
            aria-label="Müşteri ekle"
            aria-expanded={formOpen}
            onClick={() => {
              setFormOpen((current) => !current);
              setSaveState("idle");
            }}
          >
            + Müşteri ekle
          </button>
        )}
        context="Müşteri masası"
        note="Sözleşme, ziyaret ve tahsilat durumuna tek bakış."
        title="Müşteriler"
      />

          {formOpen ? (
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
                <div className="entry-actions">
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => setFormOpen(false)}
                  >
                    Vazgeç
                  </button>
                  <button className="primary-action" disabled={saveState === "saving"} type="submit">
                    {saveState === "saving" ? "Kaydediliyor…" : "Müşteriyi kaydet"}
                  </button>
                </div>
                {saveState === "error" ? (
                  <p className="entry-error" role="alert">
                    Kayıt tamamlanamadı. Bağlantıyı ve alanları kontrol edip yeniden deneyin.
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
                        <td className="empty-row" colSpan={5}>
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

          {selectedCustomer ? (
            <CustomerWorkspace
              key={selectedCustomer.id}
              customer={{
                contactNote: selectedCustomer.contactNote ?? null,
                displayName: selectedCustomer.name,
                email: selectedCustomer.email ?? null,
                id: selectedCustomer.id,
                name: selectedCustomer.name,
                phone: selectedCustomer.phone ?? null,
              }}
              live={live}
              onContractSaved={handleContractSaved}
              onCustomerSaved={handleCustomerSaved}
              onVisitsSaved={handleVisitsSaved}
            />
          ) : (
            <p className="workspace-selector-note">
              Sözleşme ve ziyaret planını açmak için müşteri adını seçin.
            </p>
          )}

    </div>
  );
}
