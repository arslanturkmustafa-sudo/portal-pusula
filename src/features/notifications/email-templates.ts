import "server-only";

import type {
  DailyAgendaItem,
  DailyPlanTask,
} from "@/features/daily-plan";
import type { FinanceDigestItem } from "@/features/finance/finance-digest-repository";
import type { Expense } from "@/features/finance/spending-repository";
import type { EmailMessage } from "@/platform/email/outbox-email";

const PORTAL_DAILY_PLAN_URL =
  "https://portal.muhendiskafasi.com.tr/gunluk-plan";
const MAX_ITEMS_PER_SECTION = 50;

const paymentMethodLabels = {
  bank_transfer: "Banka transferi",
  cash: "Nakit",
  credit_card: "Kredi kartı",
  other: "Diğer",
} as const satisfies Record<Expense["paymentMethod"], string>;

export type DailyDigestTemplateInput = Readonly<{
  businessDate: string;
  financeItems?: readonly FinanceDigestItem[];
  recipientName: string;
  tasks: readonly DailyPlanTask[];
  visits: readonly DailyAgendaItem[];
}>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateAtNoonUtc(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long",
    timeZone: "Europe/Istanbul",
  }).format(dateAtNoonUtc(value));
}

function databaseUtcDate(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/u.exec(
      value,
    );
  if (match === null) return null;

  const milliseconds = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      milliseconds,
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function visitTimeLabel(value: string | null): string {
  if (value === null) return "Saat belirtilmedi";
  const instant = databaseUtcDate(value);
  if (instant === null) return "Saat belirtilmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(instant);
}

function visitText(visit: DailyAgendaItem): string {
  const location =
    visit.locationLabel === null ? "" : ` · ${visit.locationLabel}`;
  return `${visitTimeLabel(visit.internalPlannedAtUtc)} · ${visit.customerName} (${visit.customerCode})${location}`;
}

function taskContext(task: DailyPlanTask): string {
  return [task.customerName, task.projectName].filter(Boolean).join(" · ");
}

function taskText(task: DailyPlanTask): string {
  const context = taskContext(task);
  return context === "" ? task.title : `${task.title} · ${context}`;
}

function moneyLabel(value: string): string {
  return new Intl.NumberFormat("tr-TR", {
    currency: "TRY",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}

function financeItemText(
  item: FinanceDigestItem,
  businessDate: string,
): string {
  const timing = item.dueOn < businessDate ? "Gecikmiş" : "Bugün";
  const source = item.sourceLabel === null ? "" : ` · ${item.sourceLabel}`;
  return `${timing} · ${dateLabel(item.dueOn)} · ${item.label}${source} · ${moneyLabel(item.remainingAmount)}`;
}

function visibleItems<T>(items: readonly T[]): readonly T[] {
  return items.slice(0, MAX_ITEMS_PER_SECTION);
}

function remainingLabel(total: number): string | null {
  const remaining = total - MAX_ITEMS_PER_SECTION;
  return remaining > 0 ? `${remaining} kayıt daha portalda` : null;
}

function textSection(
  heading: string,
  rows: readonly string[],
  total: number,
): string {
  const remaining = remainingLabel(total);
  return [
    `${heading} (${total})`,
    ...rows.map((row) => `- ${row}`),
    ...(remaining === null ? [] : [`- ${remaining}`]),
  ].join("\n");
}

function htmlSection(
  heading: string,
  rows: readonly string[],
  total: number,
): string {
  const remaining = remainingLabel(total);
  const items = [
    ...rows.map(
      (row) =>
        `<li style="margin:0;padding:10px 0;border-bottom:1px solid #e5e7eb;color:#1f2937;line-height:1.45">${escapeHtml(row)}</li>`,
    ),
    ...(remaining === null
      ? []
      : [
          `<li style="margin:0;padding:10px 0;color:#64748b;line-height:1.45">${escapeHtml(remaining)}</li>`,
        ]),
  ].join("");

  return `<section style="margin-top:24px">
    <h2 style="margin:0 0 6px;font-size:17px;color:#0f172a">${escapeHtml(heading)} <span style="color:#64748b;font-weight:500">(${total})</span></h2>
    <ul style="margin:0;padding:0;list-style:none">${items}</ul>
  </section>`;
}

export function createDailyDigestEmail(
  input: DailyDigestTemplateInput,
): EmailMessage {
  const label = dateLabel(input.businessDate);
  const visitRows = visibleItems(input.visits).map(visitText);
  const taskRows = visibleItems(input.tasks).map(taskText);
  const receivables = (input.financeItems ?? []).filter(
    (item) => item.direction === "inflow",
  );
  const payments = (input.financeItems ?? []).filter(
    (item) => item.direction === "outflow",
  );
  const receivableRows = visibleItems(receivables).map((item) =>
    financeItemText(item, input.businessDate),
  );
  const paymentRows = visibleItems(payments).map((item) =>
    financeItemText(item, input.businessDate),
  );
  const financeTextSections =
    input.financeItems === undefined
      ? []
      : [
          "",
          textSection(
            "Vadesi gelen alacaklar",
            receivableRows,
            receivables.length,
          ),
          "",
          textSection(
            "Vadesi gelen ödemeler",
            paymentRows,
            payments.length,
          ),
        ];
  const financeHtmlSections =
    input.financeItems === undefined
      ? ""
      : `${htmlSection("Vadesi gelen alacaklar", receivableRows, receivables.length)}
          ${htmlSection("Vadesi gelen ödemeler", paymentRows, payments.length)}`;
  const greeting = input.recipientName.trim() || "Portal kullanıcısı";
  const text = [
    `Merhaba ${greeting},`,
    "",
    `${label} için günlük planınız hazır.`,
    "",
    textSection("Ziyaretler", visitRows, input.visits.length),
    "",
    textSection("Yapılacak görevler", taskRows, input.tasks.length),
    ...financeTextSections,
    "",
    `Günlük planı açın: ${PORTAL_DAILY_PLAN_URL}`,
  ].join("\n");

  const html = `<!doctype html>
  <html lang="tr">
    <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
      <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(`${input.visits.length} ziyaret, ${input.tasks.length} görev${input.financeItems === undefined ? "" : `, ${input.financeItems.length} vadeli finans kaydı`}`)}</div>
      <main style="max-width:640px;margin:0 auto;padding:28px 16px">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.06)">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0f766e">Portal Pusula</div>
          <h1 style="margin:8px 0 8px;font-size:26px;line-height:1.2;color:#0f172a">Bugünün çalışma planı</h1>
          <p style="margin:0;color:#475569;line-height:1.55">Merhaba ${escapeHtml(greeting)}, ${escapeHtml(label)} için planlanan çalışmalar aşağıdadır.</p>
          ${htmlSection("Ziyaretler", visitRows, input.visits.length)}
          ${htmlSection("Yapılacak görevler", taskRows, input.tasks.length)}
          ${financeHtmlSections}
          <a href="${PORTAL_DAILY_PLAN_URL}" style="display:inline-block;margin-top:26px;padding:11px 16px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700">Günlük planı aç</a>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Bu ileti Portal Pusula tarafından otomatik oluşturuldu.</p>
        </div>
      </main>
    </body>
  </html>`;

  return {
    html,
    subject: `Bugünün planı · ${label}`,
    text,
  };
}

export function buildExpenseCreatedEmail(
  expense: Pick<
    Expense,
    | "category"
    | "currency"
    | "description"
    | "incurredOn"
    | "paymentMethod"
    | "totalAmount"
    | "vendorName"
  >,
): EmailMessage {
  const amount = new Intl.NumberFormat("tr-TR", {
    currency: expense.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(expense.totalAmount));
  const label = dateLabel(expense.incurredOn);
  const paymentMethod = paymentMethodLabels[expense.paymentMethod];
  const vendor = expense.vendorName?.trim() || null;
  const rows = [
    ["Açıklama", expense.description],
    ["Kategori", expense.category],
    ["Tarih", label],
    ...(vendor === null ? [] : [["Firma", vendor]]),
    ["Ödeme yöntemi", paymentMethod],
    ["Toplam", amount],
  ] as const;
  const text = [
    "Yeni bir gider kaydı oluşturuldu.",
    "",
    ...rows.map(([key, value]) => `${key}: ${value}`),
    "",
    "Ayrıntıları güvenli biçimde Portal Pusula'dan görüntüleyebilirsiniz.",
  ].join("\n");
  const htmlRows = rows
    .map(
      ([key, value]) =>
        `<tr><th scope="row" style="padding:8px 12px 8px 0;text-align:left;vertical-align:top;color:#64748b;font-size:13px">${escapeHtml(key)}</th><td style="padding:8px 0;color:#0f172a;font-size:14px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return {
    html: `<!doctype html>
    <html lang="tr">
      <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
        <main style="max-width:600px;margin:0 auto;padding:28px 16px">
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px">
            <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0f766e">Portal Pusula</div>
            <h1 style="margin:8px 0 16px;font-size:24px;line-height:1.2">Yeni gider kaydı</h1>
            <table role="presentation" style="width:100%;border-collapse:collapse">${htmlRows}</table>
            <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Ayrıntıları güvenli biçimde Portal Pusula'dan görüntüleyebilirsiniz.</p>
          </div>
        </main>
      </body>
    </html>`,
    subject: `Yeni gider kaydı · ${amount}`,
    text,
  };
}
