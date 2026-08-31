import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("append-only audit repository policy", () => {
  it("exposes insert-only SQL with no update or delete path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src", "platform", "audit", "repository.ts"),
      "utf8",
    );
    expect(source).toMatch(/INSERT\s+INTO\s+audit_event/iu);
    expect(source).not.toMatch(/UPDATE\s+audit_event/iu);
    expect(source).not.toMatch(/DELETE\s+FROM\s+audit_event/iu);
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+(?:update|delete)/iu);
  });
});
