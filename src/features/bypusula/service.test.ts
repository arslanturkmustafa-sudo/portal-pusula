import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import type { AnalysisRow } from "./repository";
vi.mock("server-only", () => ({}));
vi.mock("./repository");
vi.mock("@/features/tasks/service", () => ({ createTaskInTransaction: vi.fn() }));
vi.mock("@/platform/audit/repository", () => ({ appendAuditEvent: vi.fn() }));
vi.mock("@/platform/jobs/mysql-transaction", () => ({ withUtcTransaction: vi.fn() }));

import * as repository from "./repository";
import { createTaskInTransaction } from "@/features/tasks/service";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { canonicalEnvelope, analysisKey } from "./identity";
import { importTransfer, receiveTransfer } from "./service";
import { exampleEnvelope } from "./fixtures.test-support";

const pool = {} as Pool;
const id = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const context = { actorId: "55555555-5555-4555-8555-555555555555", correlationId: "test-bypusula" };
const snapshot = canonicalEnvelope(exampleEnvelope);
const key = (number: number) => `PRG-GOV-01/IMPLEMENTATION_ACTION_0${number}`;
const input = (selected = [key(1), key(2), key(3)]) => ({ action: "import", id, digest: snapshot.digest, customerId, projectId, selected });
let row: AnalysisRow;
let links: Map<string, { key: string; taskId: string }>;
let tasks: Map<string, { title: string; status: string }>;
let tail: Promise<unknown>;
let failStep: string | null;

beforeEach(() => {
  vi.clearAllMocks(); tail = Promise.resolve(); links = new Map(); tasks = new Map(); failStep = null;
  row = { id, source_key: analysisKey(exampleEnvelope), payload_digest: snapshot.digest, payload_json: JSON.stringify(snapshot.envelope), customer_id: null, project_id: null } as AnalysisRow;
  // Emulate committed transactions and rollback. The production adapter uses
  // SELECT FOR UPDATE on the intake row plus a unique DB source key.
  vi.mocked(withUtcTransaction).mockImplementation(async (_pool, operation) => {
    const run = tail.then(async () => {
      const backup = { row: { ...row }, links: new Map(links), tasks: new Map(tasks) };
      try { return await operation({} as never); }
      catch (error) { row = backup.row; links = backup.links; tasks = backup.tasks; throw error; }
    });
    tail = run.catch(() => undefined);
    return run;
  });
  vi.mocked(repository.findAnalysis).mockImplementation(async () => row);
  vi.mocked(repository.receiveAnalysis).mockImplementation(async () => row);
  vi.mocked(repository.listCandidates).mockResolvedValue([]);
  vi.mocked(repository.validMapping).mockResolvedValue(true);
  vi.mocked(repository.saveMapping).mockImplementation(async (_connection, _id, mapping) => { row.customer_id = mapping.customerId; row.project_id = mapping.projectId; });
  vi.mocked(repository.listLinks).mockImplementation(async () => [...links.values()]);
  vi.mocked(repository.findLink).mockImplementation(async (_connection, sourceKey) => links.get(sourceKey)?.taskId ?? null);
  vi.mocked(repository.insertLink).mockImplementation(async (_connection, item) => {
    if (item.key === failStep) throw new Error("Synthetic storage failure");
    links.set(item.sourceKey, { key: item.key, taskId: item.taskId });
  });
  vi.mocked(createTaskInTransaction).mockImplementation(async (_connection, task) => {
    const taskId = `task-${tasks.size + 1}`;
    tasks.set(taskId, { title: task.title, status: "backlog" });
    return { id: taskId } as never;
  });
});

describe("ByPusula import safety", () => {
  it("reuses exact intake and rejects changed content without replacing its snapshot", async () => {
    expect((await receiveTransfer(pool, exampleEnvelope, context)).id).toBe(id);
    await expect(receiveTransfer(pool, { ...exampleEnvelope, company: { ...exampleEnvelope.company, name: "Changed" } }, context)).rejects.toMatchObject({ code: "snapshot_conflict" });
    expect(row.payload_digest).toBe(snapshot.digest);
  });

  it("serializes concurrent retries and preserves done/cancelled/manual task states", async () => {
    const [first, second] = await Promise.all([importTransfer(pool, input(), context), importTransfer(pool, input(), context)]);
    expect([...first, ...second].filter((result) => result.status === "created")).toHaveLength(3);
    expect(tasks.size).toBe(3);
    tasks.set("task-1", { title: "Elle değiştirildi", status: "done" });
    tasks.set("task-2", { title: "İptal edilen", status: "cancelled" });
    tasks.set("task-3", { title: "Arşivlenen", status: "archived" });
    const before = new Map(tasks);
    expect((await importTransfer(pool, input(), context)).every((result) => result.status === "existing")).toBe(true);
    expect(tasks).toEqual(before);
    expect(createTaskInTransaction).toHaveBeenCalledTimes(3);
  });

  it("rolls back a failed step including its task, retains other steps and retries only the missing task", async () => {
    failStep = key(2);
    expect((await importTransfer(pool, input(), context)).map((result) => result.status)).toEqual(["created", "failed", "created"]);
    expect(tasks.size).toBe(2); expect(links.size).toBe(2);
    failStep = null;
    expect((await importTransfer(pool, input(), context)).map((result) => result.status)).toEqual(["existing", "created", "existing"]);
    expect(tasks.size).toBe(3);
  });

  it("rejects stale previews, unreviewed selections and invalid or conflicting mappings before creating tasks", async () => {
    await expect(importTransfer(pool, { ...input(), digest: "a".repeat(64) }, context)).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(importTransfer(pool, input([key(4)]), context)).rejects.toMatchObject({ code: "selection_invalid" });
    vi.mocked(repository.validMapping).mockResolvedValueOnce(false);
    await expect(importTransfer(pool, input(), context)).rejects.toMatchObject({ code: "mapping_changed" });
    expect(tasks.size).toBe(0);
    await importTransfer(pool, input([key(1)]), context);
    await expect(importTransfer(pool, { ...input(), projectId: context.actorId }, context)).rejects.toMatchObject({ code: "mapping_changed" });
    expect(tasks.size).toBe(1);
  });
});
