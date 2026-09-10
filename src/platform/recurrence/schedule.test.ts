import { describe, expect, it } from "vitest";

import {
  nextOccurrenceOn,
  occurrenceDatesInRange,
} from "@/platform/recurrence/schedule";

describe("recurrence schedule", () => {
  it("preserves a monthly anchor after a short month", () => {
    expect(nextOccurrenceOn("2028-01-31", "monthly", 31)).toBe("2028-02-29");
    expect(nextOccurrenceOn("2028-02-29", "monthly", 31)).toBe("2028-03-31");
  });

  it("expands weekly dates inside the requested range and end date", () => {
    expect(
      occurrenceDatesInRange({
        anchorDay: 1,
        endsOn: "2026-09-22",
        firstOn: "2026-09-01",
        frequency: "weekly",
        from: "2026-09-08",
        to: "2026-09-30",
      }),
    ).toEqual(["2026-09-08", "2026-09-15", "2026-09-22"]);
  });
});
