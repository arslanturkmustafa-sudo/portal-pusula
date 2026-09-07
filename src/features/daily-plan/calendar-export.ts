import "server-only";

import { Buffer } from "node:buffer";

import type { DailyAgenda } from "./service";

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/gu, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldIcsLine(line: string): string {
  const folded: string[] = [];
  let current = "";
  let limit = 75;
  for (const character of line) {
    if (
      current.length > 0 &&
      Buffer.byteLength(current + character, "utf8") > limit
    ) {
      folded.push(current);
      current = character;
      limit = 74;
    } else {
      current += character;
    }
  }
  folded.push(current);
  return folded.join("\r\n ");
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function dateAtNoonUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function nextDate(value: string): string | null {
  if (value === "9999-12-31") return null;
  const date = dateAtNoonUtc(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function compactUtcDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace(/[-:]/gu, "") + "Z";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function customerNameForAgenda(
  agenda: DailyAgenda,
  customerId: string,
): string {
  if (agenda.items.some((item) => item.customerId !== customerId)) {
    throw new Error("Calendar customer scope is invalid.");
  }
  return (
    agenda.items[0]?.customerName ??
    agenda.customers.find((customer) => customer.id === customerId)?.name ??
    "Seçili müşteri"
  );
}

export function scopeDailyAgendaForCustomerExport(
  agenda: DailyAgenda,
  customerId: string,
  locationLabel?: string,
): DailyAgenda {
  customerNameForAgenda(agenda, customerId);
  return {
    ...agenda,
    items:
      locationLabel === undefined
        ? agenda.items
        : agenda.items.filter((item) => item.locationLabel === locationLabel),
    tasks: [],
  };
}

function shareableVisits(agenda: DailyAgenda): readonly DailyAgenda["items"][number][] {
  return agenda.items.filter(
    (visit) =>
      visit.resolutionStatus === "planned" ||
      visit.resolutionStatus === "makeup_pending",
  );
}

function shareableVisitStatus(
  status: DailyAgenda["items"][number]["resolutionStatus"],
): string {
  return status === "makeup_pending" ? "Telafi ziyareti" : "Planlanan müşteri ziyareti";
}

export function buildDailyAgendaIcs(
  agenda: DailyAgenda,
  customerId: string,
  generatedAt = new Date(),
): string {
  const customerName = customerNameForAgenda(agenda, customerId);
  const stamp = compactUtcDateTime(generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Portal Pusula//Musteri Takvimi//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`${customerName} · Portal Pusula`)}`,
  ];

  for (const visit of shareableVisits(agenda)) {
    lines.push("BEGIN:VEVENT", `UID:visit-${visit.visitId}@portal-pusula`, `DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${compactDate(visit.committedOn)}`);
    const exclusiveEnd = nextDate(visit.committedOn);
    if (exclusiveEnd !== null) {
      lines.push(`DTEND;VALUE=DATE:${compactDate(exclusiveEnd)}`);
    }
    lines.push(
      `SUMMARY:${escapeIcsText(`${visit.customerName} ziyareti`)}`,
      `DESCRIPTION:${escapeIcsText(shareableVisitStatus(visit.resolutionStatus))}`,
    );
    if (visit.locationLabel !== null) {
      lines.push(`LOCATION:${escapeIcsText(visit.locationLabel)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function buildDailyAgendaPrintHtml(
  agenda: DailyAgenda,
  customerId: string,
): string {
  const customerName = customerNameForAgenda(agenda, customerId);
  const rows = [
    ...shareableVisits(agenda).map((visit) => ({
      context: visit.locationLabel ?? "—",
      date: visit.committedOn,
      detail: shareableVisitStatus(visit.resolutionStatus),
      id: `visit-${visit.visitId}`,
      kind: "Ziyaret",
      title: visit.customerName,
    })),
  ].sort((left, right) =>
    left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
  const rowHtml =
    rows.length === 0
      ? '<p class="empty">Seçilen dönemde plan kaydı bulunmuyor.</p>'
      : `<table><thead><tr><th>Tarih</th><th>Tür</th><th>Kayıt</th><th>Konum</th><th>Durum</th></tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.context)}</td><td>${escapeHtml(row.detail)}</td></tr>`,
          )
          .join("")}</tbody></table>`;

  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(customerName)} takvimi · Portal Pusula</title><style>
:root{font-family:Arial,sans-serif;color:#172033;background:#f4f5f7}body{margin:0;padding:32px}main{max-width:1040px;margin:auto;padding:32px;background:#fff;border:1px solid #d9dde5}header{display:flex;justify-content:space-between;gap:24px;padding-bottom:20px;border-bottom:2px solid #172033}h1{margin:4px 0;font-size:28px}.eyebrow{margin:0;color:#667085;font-size:11px;font-weight:700;letter-spacing:.08em}.range{margin:6px 0 0;color:#475467}table{width:100%;margin-top:24px;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid #d9dde5;text-align:left;vertical-align:top}th{font-size:10px;letter-spacing:.05em;text-transform:uppercase}.notice,.empty{margin-top:24px;color:#667085;font-size:12px}@media print{body{padding:0;background:#fff}main{max-width:none;padding:0;border:0}.notice{display:none}@page{size:A4 landscape;margin:14mm}}
</style></head><body><main><header><div><p class="eyebrow">PORTAL PUSULA / MÜŞTERİ TAKVİMİ</p><h1>${escapeHtml(customerName)}</h1><p class="range">${escapeHtml(agenda.range.startDate)} – ${escapeHtml(agenda.range.endDate)}</p></div><strong>${rows.length} ziyaret</strong></header>${rowHtml}<p class="notice">Bu müşteri çıktısı yalnız planlanan ve telafi bekleyen ziyaret günlerini ve paylaşılabilir konumları içerir; tamamlanan veya iptal edilen kayıtlar, iç görevler, saatler ve süreler dahil edilmez. PDF için tarayıcınızın Yazdır komutunu kullanın.</p></main></body></html>`;
}
