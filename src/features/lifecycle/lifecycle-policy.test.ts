// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(resolve(projectRoot, path), "utf8");
}

describe("record lifecycle integration policy", () => {
  it.each([
    "src/app/api/customers/[id]/lifecycle/route.ts",
    "src/app/api/projects/[id]/lifecycle/route.ts",
    "src/app/api/tasks/[id]/lifecycle/route.ts",
    "src/app/api/customers/[id]/contracts/[contractId]/lifecycle/route.ts",
  ])("uses an explicit account-attributed POST command without DELETE: %s", async (path) => {
    const text = await source(path);
    expect(text).toMatch(/export async function POST\(/u);
    expect(text).not.toMatch(/export async function DELETE\(/u);
    expect(text).toContain('principal.kind !== "account"');
    expect(text).toMatch(/hasPermission\(principal, "(?:customers|projects|tasks|contracts)\.lifecycle"\)/u);
    expect(text).toContain("lifecycleCommandInputSchema.parse");
    expect(text).toContain("isSameOriginWriteRequest");
    expect(text).toContain("private, no-store");
  });

  it.each([
    "src/features/customers/repository.ts",
    "src/features/projects/repository.ts",
    "src/features/tasks/repository.ts",
    "src/features/contracts/repository.ts",
  ])("optimistically fences lifecycle persistence: %s", async (path) => {
    const text = await source(path);
    expect(text).toContain("archive_reason");
    expect(text).toContain("archived_at_utc");
    expect(text).toContain("archived_by_user_account_id");
    expect(text).toMatch(/WHERE[\s\S]*version = \?/u);
  });

  it("keeps destructive SQL out of public lifecycle routes", async () => {
    const routes = await Promise.all([
      source("src/app/api/customers/[id]/lifecycle/route.ts"),
      source("src/app/api/projects/[id]/lifecycle/route.ts"),
      source("src/app/api/tasks/[id]/lifecycle/route.ts"),
      source(
        "src/app/api/customers/[id]/contracts/[contractId]/lifecycle/route.ts",
      ),
    ]);
    expect(routes.join("\n")).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP)\b/u);
  });

  it("treats only active, net-outstanding receivables as archive blockers", async () => {
    for (const path of [
      "src/features/customers/repository.ts",
      "src/features/projects/repository.ts",
      "src/features/contracts/repository.ts",
    ]) {
      const text = await source(path);
      expect(text).toContain("r.record_state = 'active'");
      expect(text).toContain("WHEN entry_type = 'reversal' THEN -amount");
      expect(text).toContain(
        "r.total_amount > COALESCE(rc.collected_amount, 0.0000)",
      );
    }
  });
});
