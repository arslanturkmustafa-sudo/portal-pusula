"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProjectFinanceTotals = Readonly<{
  accruedNetAmount: string;
  accruedTotalAmount: string;
  accruedVatAmount: string;
  collectedAmount: string;
  commissionCount: number;
  contributionCount: number;
  collectionCount: number;
  expenseCount: number;
  expenseNetAmount: string;
  expenseTotalAmount: string;
  expenseVatAmount: string;
  outstandingAmount: string;
  overdueAmount: string;
  partnerContributionExpectedAmount: string;
  partnerContributionReceivedAmount: string;
  partnershipEarnedAmount: string;
  partnershipPaidAmount: string;
  preTaxOperatingDifference: string;
  receivableCount: number;
}>;

type ProjectFinanceLine = ProjectFinanceTotals &
  Readonly<{
    activeCustomerCount: number;
    displayName: string;
    id: string;
    projectType: "consulting" | "product" | "partnership" | "internal";
    shortCode: string;
    status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
  }>;

type ProjectFinancePayload = Readonly<{
  generatedOn: string;
  month: string;
  portfolio: ProjectFinanceTotals;
  projects: readonly ProjectFinanceLine[];
  unassigned: ProjectFinanceTotals;
}>;

const statusLabels: Record<ProjectFinanceLine["status"], string> = {
  active: "Aktif",
  cancelled: "İptal",
  completed: "Tamamlandı",
  on_hold: "Beklemede",
  planned: "Planlandı",
};

function istanbulMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

function formatMoney(value: string): string {
  try {
    const [integer, fraction] = new Decimal(value).toFixed(2).split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
    return fraction === "00" ? `₺${grouped}` : `₺${grouped},${fraction}`;
  } catch {
    return "—";
  }
}

function addMoney(...values: readonly string[]): string {
  return values
    .reduce((total, value) => total.plus(value), new Decimal(0))
    .toFixed(4);
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

function hasFinancialRecord(totals: ProjectFinanceTotals): boolean {
  return (
    totals.receivableCount > 0 ||
    totals.collectionCount > 0 ||
    totals.expenseCount > 0
  );
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

export function ProjectFinanceWorkspace() {
  const [month, setMonth] = useState(istanbulMonth);
  const [payload, setPayload] = useState<ProjectFinancePayload | null>(null);
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/finance/project-summary?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!response.ok) throw new Error("Project report is unavailable.");
        return (await response.json()) as ProjectFinancePayload;
      })
      .then((nextPayload) => {
        if (nextPayload === null) return;
        setPayload(nextPayload);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });
    return () => controller.abort();
  }, [month, revision]);

  const visibleProjects = useMemo(() => payload?.projects ?? [], [payload]);
  const hasUnassigned = payload !== null && hasFinancialRecord(payload.unassigned);

  return (
    <section className="project-finance-workspace" aria-labelledby="project-finance-title">
      <header className="project-finance-heading">
        <div>
          <p className="eyebrow">Aylık proje defteri</p>
          <h2 id="project-finance-title">Proje bazlı finans görünümü</h2>
          <p>
            Danışmanlık alacağı, ortaklık payı, kira katkısı, tahsilat ve gider
            aynı tabloda; kalemler birbirinden ayrı ve uzlaşabilir görünür.
          </p>
        </div>
        <label>
          <span>Rapor dönemi</span>
          <input
            aria-label="Rapor dönemi"
            max="9999-12"
            min="1000-01"
            type="month"
            value={month}
            onChange={(event) => {
              setLoadState("loading");
              setMonth(event.target.value);
            }}
          />
        </label>
      </header>

      {loadState === "error" ? (
        <div className="finance-workspace-message is-error" role="alert">
          <span>Proje raporuna ulaşılamadı. Bağlantıyı kontrol edin.</span>
          <button
            type="button"
            onClick={() => {
              setLoadState("loading");
              setRevision((value) => value + 1);
            }}
          >
            Yeniden dene
          </button>
        </div>
      ) : null}

      {loadState === "loading" && payload === null ? (
        <p className="project-finance-loading" role="status">Rapor hazırlanıyor…</p>
      ) : null}

      {payload !== null ? (
        <>
          <div className="project-finance-period" aria-live="polite">
            <strong>{formatMonth(payload.month)}</strong>
            <span>Seçilen dönemin yönetim özeti</span>
          </div>

          <dl className="project-finance-summary">
            <div>
              <dt>Hak edilen proje geliri</dt>
              <dd>{formatMoney(addMoney(
                payload.portfolio.accruedNetAmount,
                payload.portfolio.partnershipEarnedAmount,
                payload.portfolio.partnerContributionExpectedAmount,
              ))}</dd>
              <small>
                {payload.portfolio.receivableCount} alacak · {payload.portfolio.commissionCount} ortaklık payı · {payload.portfolio.contributionCount} katkı
              </small>
            </div>
            <div>
              <dt>Nakit girişi</dt>
              <dd>{formatMoney(addMoney(
                payload.portfolio.collectedAmount,
                payload.portfolio.partnershipPaidAmount,
                payload.portfolio.partnerContributionReceivedAmount,
              ))}</dd>
              <small>Alacak + ödenen ortaklık payı + alınan kira katkısı</small>
            </div>
            <div>
              <dt>Gider · net</dt>
              <dd>{formatMoney(payload.portfolio.expenseNetAmount)}</dd>
              <small>{payload.portfolio.expenseCount} aktif gider</small>
            </div>
            <div className={Number(payload.portfolio.preTaxOperatingDifference) < 0 ? "is-negative" : "is-positive"}>
              <dt>Vergi öncesi faaliyet farkı</dt>
              <dd>{formatMoney(payload.portfolio.preTaxOperatingDifference)}</dd>
              <small>Proje geliri − gider net</small>
            </div>
          </dl>

          {hasUnassigned ? (
            <aside className="project-finance-unassigned" role="status">
              <div>
                <strong>Projesi belirlenmemiş finans kaydı var</strong>
                <span>
                  {payload.unassigned.receivableCount} alacak, {payload.unassigned.collectionCount} tahsilat, {payload.unassigned.expenseCount} gider
                </span>
              </div>
              <p>
                Bu tutarlar portföy toplamına dahildir ancak proje satırlarına
                dağıtılmamıştır. Finans kayıtlarını düzenleyerek projelerini seçin.
              </p>
            </aside>
          ) : null}

          <div className="project-finance-table-wrap">
            <table className="project-finance-table" aria-label={`${formatMonth(payload.month)} proje finans raporu`}>
              <thead>
                <tr>
                  <th scope="col">Proje</th>
                  <th scope="col">Müşteri</th>
                  <th scope="col">Hak edilen gelir</th>
                  <th scope="col">Nakit girişi</th>
                  <th scope="col">Gider</th>
                  <th scope="col">Faaliyet farkı</th>
                  <th scope="col">Açık / gecikmiş</th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project) => (
                  <tr key={project.id}>
                    <td data-label="Proje">
                      <Link href="/projeler">
                        <strong>{project.displayName}</strong>
                        <small>{project.shortCode} · {statusLabels[project.status]}</small>
                      </Link>
                    </td>
                    <td data-label="Müşteri">{project.activeCustomerCount}</td>
                    <td data-label="Hak edilen gelir">
                      <strong>{formatMoney(addMoney(
                        project.accruedNetAmount,
                        project.partnershipEarnedAmount,
                        project.partnerContributionExpectedAmount,
                      ))}</strong>
                      <small>
                        Danışmanlık {formatMoney(project.accruedNetAmount)} · ortaklık {formatMoney(project.partnershipEarnedAmount)} · katkı {formatMoney(project.partnerContributionExpectedAmount)} · KDV {formatMoney(project.accruedVatAmount)}
                      </small>
                    </td>
                    <td data-label="Nakit girişi">
                      <strong>{formatMoney(addMoney(
                        project.collectedAmount,
                        project.partnershipPaidAmount,
                        project.partnerContributionReceivedAmount,
                      ))}</strong>
                      <small>
                        Alacak {formatMoney(project.collectedAmount)} · ortaklık {formatMoney(project.partnershipPaidAmount)} · katkı {formatMoney(project.partnerContributionReceivedAmount)}
                      </small>
                    </td>
                    <td data-label="Gider">
                      <strong>{formatMoney(project.expenseNetAmount)}</strong>
                      <small>KDV {formatMoney(project.expenseVatAmount)}</small>
                    </td>
                    <td data-label="Faaliyet farkı" className={Number(project.preTaxOperatingDifference) < 0 ? "is-negative" : "is-positive"}>
                      {formatMoney(project.preTaxOperatingDifference)}
                    </td>
                    <td data-label="Açık / gecikmiş">
                      <strong>{formatMoney(project.outstandingAmount)}</strong>
                      <small>Gecikmiş {formatMoney(project.overdueAmount)}</small>
                    </td>
                  </tr>
                ))}
                {visibleProjects.length === 0 ? (
                  <tr>
                    <td className="empty-row" colSpan={7}>Henüz raporlanacak proje yok.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="project-finance-method-note">
            Danışmanlık geliri seçilen aya ait alacakları; ortaklık geliri ajansın
            tahsil ettiği ay hak edilen payı; katkı ise ortağın o aya ait ofis
            payını gösterir. Nakit girişi yalnız gerçekleşen ödemeleri içerir.
            Açık ve gecikmiş tutarlar seçilen ayda doğan yükümlülüklerin bugün
            itibarıyla kalan bakiyesidir.
            “Vergi öncesi faaliyet farkı” resmi kâr veya vergi hesabı değildir.
          </p>
        </>
      ) : null}
    </section>
  );
}
