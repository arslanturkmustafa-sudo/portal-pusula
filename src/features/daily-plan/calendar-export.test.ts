// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDailyAgendaIcs,
  buildDailyAgendaPrintHtml,
  scopeDailyAgendaForCustomerExport,
} from "@/features/daily-plan/calendar-export";
import type { DailyAgenda } from "@/features/daily-plan/service";

const customerId = "10000000-0000-4000-8000-000000000001";

function agenda(): DailyAgenda {
  return {
    customers: [
      { code: "ATLAS", id: customerId, name: "Atlas <Makina>" },
    ],
    date: "2026-09-02",
    items: [
      {
        committedOn: "2026-09-02",
        contractId: "20000000-0000-4000-8000-000000000001",
        customerCode: "ATLAS",
        customerId,
        customerName: "Atlas <Makina>",
        deliveredOn: null,
        internalDurationMinutes: 45,
        internalPlannedAtUtc: "2026-09-02 06:30:00.000000",
        locationLabel: "Ofis, Kat 2",
        resolutionNote: null,
        resolutionStatus: "planned",
        visitId: "30000000-0000-4000-8000-000000000001",
      },
    ],
    range: { endDate: "2026-09-30", startDate: "2026-09-01" },
    tasks: [
      {
        calendarOn: "2026-09-02",
        calendarSource: "visit",
        customerId,
        customerName: "Atlas <Makina>",
        dueOn: "2026-09-05",
        id: "40000000-0000-4000-8000-000000000001",
        linkedVisitId: "30000000-0000-4000-8000-000000000001",
        locationLabel: "Çevrim içi; Teams",
        projectName: "Dönüşüm & güvenlik",
        status: "todo",
        title: "Uzun müşteri görevini görüş, notları paylaş ve sonraki adımları doğrula",
      },
    ],
    view: "month",
  };
}

describe("daily agenda customer exports", () => {
  it("builds escaped, folded RFC-style calendar content", () => {
    const output = buildDailyAgendaIcs(
      agenda(),
      customerId,
      new Date("2026-09-01T12:00:00.000Z"),
    );

    expect(output).toContain("BEGIN:VCALENDAR\r\n");
    expect(output).toContain("LOCATION:Ofis\\, Kat 2");
    expect(output).toContain("DTSTART;VALUE=DATE:20260902");
    expect(output).not.toContain("Çevrim içi");
    expect(output).not.toContain("Uzun müşteri görevini görüş");
    expect(output).not.toContain("20260902T063000Z");
    expect(output).toContain("DTSTAMP:20260901T120000Z");
    expect(output.endsWith("\r\n")).toBe(true);
    for (const line of output.split("\r\n").filter(Boolean)) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("escapes every projected value in the printable document", () => {
    const output = buildDailyAgendaPrintHtml(agenda(), customerId);

    expect(output).toContain("Atlas &lt;Makina&gt;");
    expect(output).not.toContain("Dönüşüm &amp; güvenlik");
    expect(output).not.toContain("Uzun müşteri görevini görüş");
    expect(output).not.toContain("45 dk");
    expect(output).not.toContain("Atlas <Makina>");
    expect(output).toContain("2026-09-01 – 2026-09-30");
  });

  it("fails closed if a repository result crosses the requested customer scope", () => {
    const contaminated = {
      ...agenda(),
      items: [
        {
          ...agenda().items[0],
          customerId: "10000000-0000-4000-8000-000000000002",
        },
      ],
    };

    expect(() => buildDailyAgendaIcs(contaminated, customerId)).toThrow(
      "Calendar customer scope is invalid.",
    );
    expect(() => buildDailyAgendaPrintHtml(contaminated, customerId)).toThrow(
      "Calendar customer scope is invalid.",
    );
  });

  it("limits customer output to the exact selected location without disclosing another location", () => {
    const source = agenda();
    const otherLocation = "Gizli şube";
    const scoped = scopeDailyAgendaForCustomerExport(
      {
        ...source,
        items: [
          source.items[0],
          {
            ...source.items[0],
            locationLabel: otherLocation,
            visitId: "30000000-0000-4000-8000-000000000002",
          },
        ],
      },
      customerId,
      "Ofis, Kat 2",
    );

    const ics = buildDailyAgendaIcs(scoped, customerId);
    const print = buildDailyAgendaPrintHtml(scoped, customerId);
    expect(ics).toContain("LOCATION:Ofis\\, Kat 2");
    expect(ics).not.toContain(otherLocation);
    expect(print).toContain("Ofis, Kat 2");
    expect(print).not.toContain(otherLocation);
    expect(scoped.tasks).toEqual([]);
  });

  it("checks the complete repository result before removing out-of-location rows", () => {
    const source = agenda();
    expect(() =>
      scopeDailyAgendaForCustomerExport(
        {
          ...source,
          items: [
            source.items[0],
            {
              ...source.items[0],
              customerId: "10000000-0000-4000-8000-000000000002",
              locationLabel: "Başka şube",
            },
          ],
        },
        customerId,
        "Ofis, Kat 2",
      ),
    ).toThrow("Calendar customer scope is invalid.");
  });

  it("keeps the maximum supported date valid without overflowing DTEND", () => {
    const boundary = {
      ...agenda(),
      items: [
        {
          ...agenda().items[0],
          committedOn: "9999-12-31",
          internalDurationMinutes: null,
          internalPlannedAtUtc: null,
        },
      ],
      tasks: [],
    };
    const output = buildDailyAgendaIcs(boundary, customerId);

    expect(output).toContain("DTSTART;VALUE=DATE:99991231");
    expect(output).not.toContain("10000");
    expect(output).not.toContain("DTEND;VALUE=DATE");
  });

  it("excludes cancelled and completed visits and labels makeup visits truthfully", () => {
    const scoped = agenda();
    const output = buildDailyAgendaIcs(
      {
        ...scoped,
        items: [
          scoped.items[0],
          {
            ...scoped.items[0],
            resolutionStatus: "makeup_pending",
            visitId: "30000000-0000-4000-8000-000000000002",
          },
          {
            ...scoped.items[0],
            resolutionStatus: "completed",
            visitId: "30000000-0000-4000-8000-000000000003",
          },
          {
            ...scoped.items[0],
            resolutionStatus: "cancelled_by_agreement",
            visitId: "30000000-0000-4000-8000-000000000004",
          },
        ],
      },
      customerId,
    );

    expect(output.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
    expect(output).toContain("DESCRIPTION:Telafi ziyareti");
    expect(output).not.toContain("visit-30000000-0000-4000-8000-000000000003");
    expect(output).not.toContain("visit-30000000-0000-4000-8000-000000000004");
  });
});
