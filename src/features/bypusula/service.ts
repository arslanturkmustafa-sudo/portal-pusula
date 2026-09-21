import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { createTaskInTransaction, type TaskWriteContext } from "@/features/tasks/service";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { approveSyncSchema, importSchema, resolveMapping, stepKey, uuidSchema, type ImportResult, type Preview, type Mapping } from "./contract";
import { analysisKey, canonicalEnvelope, taskDescription, taskSourceKey } from "./identity";
import * as repository from "./repository";

export class TransferConflict extends Error {
  constructor(public readonly code: "snapshot_conflict" | "mapping_changed" | "selection_invalid" | "not_found") {
    super(code);
  }
}

type Context = TaskWriteContext & { actorId: string };

async function previewRow(connection: PoolConnection, row: repository.AnalysisRow): Promise<Preview> {
  const { envelope, digest } = canonicalEnvelope(JSON.parse(row.payload_json));
  if (digest !== row.payload_digest || analysisKey(envelope) !== row.source_key) throw new TransferConflict("snapshot_conflict");
  const candidates = await repository.listCandidates(connection);
  const saved = row.customer_id && row.project_id ? { customerId: row.customer_id, projectId: row.project_id } : null;
  return { id: row.id, digest, envelope, candidates, ...resolveMapping(saved, candidates), imported: await repository.listLinks(connection, row.id),
    automation: { requested: Boolean(row.sync_requested_at_utc), approved: Boolean(row.sync_approved_at_utc), lastReceivedAtUtc: row.sync_last_received_at_utc ?? null } };
}

export async function receiveTransfer(pool: Pool, raw: unknown, context: Context, automatic = false): Promise<Preview> {
  const { envelope, digest } = canonicalEnvelope(raw);
  const id = randomUUID();
  return withUtcTransaction(pool, async (connection) => {
    const row = await repository.receiveAnalysis(connection, {
      id, digest, sourceKey: analysisKey(envelope), json: JSON.stringify(envelope),
      companyName: envelope.company.name, analysisId: envelope.analysis.id, now: toUtcDateTime6(context.now ?? new Date()),
    });
    if (row.payload_digest !== digest) throw new TransferConflict("snapshot_conflict");
    if (automatic) {
      const now = toUtcDateTime6(context.now ?? new Date());
      await repository.markAutomaticDelivery(connection, row.id, now);
      row.sync_requested_at_utc ??= now;
      row.sync_last_received_at_utc = now;
    }
    if (row.id === id) await audit(connection, context, id, "bypusula.received");
    return previewRow(connection, row);
  });
}

export async function approveAutomaticTransfer(pool: Pool, raw: unknown, context: Context): Promise<Preview> {
  const input = approveSyncSchema.parse(raw);
  const mapping = { customerId: input.customerId, projectId: input.projectId };
  return withUtcTransaction(pool, async (connection) => {
    const row = await repository.findAnalysis(connection, input.id);
    if (!row) throw new TransferConflict("not_found");
    if (!row.sync_requested_at_utc) throw new TransferConflict("selection_invalid");
    if (row.payload_digest !== input.digest || canonicalEnvelope(JSON.parse(row.payload_json)).digest !== input.digest) throw new TransferConflict("snapshot_conflict");
    if (!(await repository.validMapping(connection, mapping))) throw new TransferConflict("mapping_changed");
    const differs = row.customer_id !== mapping.customerId || row.project_id !== mapping.projectId;
    if (differs && (row.sync_approved_at_utc || (await repository.listLinks(connection, row.id)).length)) throw new TransferConflict("mapping_changed");
    if (!row.sync_approved_at_utc) {
      const now = toUtcDateTime6(context.now ?? new Date());
      await repository.saveMapping(connection, row.id, mapping);
      await repository.approveAutomaticMapping(connection, row.id, context.actorId, now);
      row.customer_id = mapping.customerId; row.project_id = mapping.projectId;
      row.sync_approved_at_utc = now; row.sync_approved_by_user_account_id = context.actorId;
      await audit(connection, context, row.id, "bypusula.sync_approved", mapping);
    }
    return previewRow(connection, row);
  });
}

export async function openTransfer(pool: Pool, id: string): Promise<Preview> {
  uuidSchema.parse(id);
  return withUtcTransaction(pool, async (connection) => {
    const row = await repository.findAnalysis(connection, id);
    if (!row) throw new TransferConflict("not_found");
    return previewRow(connection, row);
  });
}

export const listTransfers = (pool: Pool) => withUtcTransaction(pool, repository.listInbox);

async function audit(connection: PoolConnection, context: Context, id: string, action: string, mapping?: Mapping) {
  await appendAuditEvent(connection, {
    actorId: context.actorId, actorType: "user", action, entityId: id, entityType: "bypusula_analysis",
    correlationId: context.correlationId, occurredAtUtc: toUtcDateTime6(context.now ?? new Date()),
    // Never copy source descriptions, URLs or complete payloads into audit/log.
    afterSummary: mapping,
  });
}

export async function importTransfer(pool: Pool, raw: unknown, context: Context): Promise<ImportResult[]> {
  const input = importSchema.parse(raw);
  const mapping = { customerId: input.customerId, projectId: input.projectId };
  // Persist the explicit reviewed mapping first. Later steps can safely retry
  // independently, including after a lost HTTP response or process shutdown.
  const envelope = await withUtcTransaction(pool, async (connection) => {
    const row = await repository.findAnalysis(connection, input.id);
    if (!row) throw new TransferConflict("not_found");
    const snapshot = canonicalEnvelope(JSON.parse(row.payload_json));
    if (input.digest !== row.payload_digest || snapshot.digest !== input.digest) throw new TransferConflict("snapshot_conflict");
    const keys = new Set(snapshot.envelope.programs.flatMap((program) => program.steps.map((step) => stepKey(program, step))));
    if (input.selected.some((key) => !keys.has(key))) throw new TransferConflict("selection_invalid");
    if (!(await repository.validMapping(connection, mapping))) throw new TransferConflict("mapping_changed");
    if (row.customer_id !== mapping.customerId || row.project_id !== mapping.projectId) {
      // An analysis with materialized tasks cannot silently split across projects.
      if (row.sync_approved_at_utc || (await repository.listLinks(connection, row.id)).length) throw new TransferConflict("mapping_changed");
      await repository.saveMapping(connection, row.id, mapping);
      await audit(connection, context, row.id, "bypusula.mapped", mapping);
    }
    return snapshot.envelope;
  });

  const results: ImportResult[] = [];
  const selected = new Set(input.selected);
  for (const program of envelope.programs) {
    for (const step of program.steps) {
      const key = stepKey(program, step);
      if (!selected.has(key)) continue;
      try {
        results.push(await withUtcTransaction(pool, async (connection): Promise<ImportResult> => {
          const row = await repository.findAnalysis(connection, input.id);
          if (!row || row.customer_id !== input.customerId || row.project_id !== input.projectId) throw new TransferConflict("mapping_changed");
          const sourceKey = taskSourceKey(envelope, program, step);
          const existing = await repository.findLink(connection, sourceKey);
          // No update path at all: done/cancelled/archived and manual edits survive.
          if (existing) return { key, status: "existing", taskId: existing };
          if (!(await repository.validMapping(connection, mapping))) throw new TransferConflict("mapping_changed");
          const task = await createTaskInTransaction(connection, {
            ...mapping, title: step.title, description: taskDescription(envelope, program, step),
            priority: step.priority, status: "backlog",
          }, context);
          await repository.insertLink(connection, { sourceKey, analysisId: input.id, key, taskId: task.id, now: toUtcDateTime6(context.now ?? new Date()) });
          return { key, status: "created", taskId: task.id };
        }));
      } catch (error) {
        results.push({ key, status: "failed", error: error instanceof TransferConflict ? "mapping_changed" : "retryable" });
      }
    }
  }
  return results;
}
