import { readUserProjectScope } from "@/features/account/project-access-repository";
import "server-only";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { listUserPermissionCodes } from "@/features/account/repository";
import { hasPermission, type AccountRole } from "@/platform/auth/permissions";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { stepKey, type Envelope } from "./contract";
import { importTransfer, openTransfer, receiveTransfer, TransferConflict } from "./service";
import type { SyncConfiguration } from "./sync-auth";

export class SyncAccessDenied extends Error {
  constructor() { super("Sync access unavailable."); }
}

export async function assertSyncActor(pool: Pool, configuration: SyncConfiguration): Promise<void> {
  await withUtcTransaction(pool, async (connection) => {
    const [rows] = await connection.execute<(RowDataPacket & { role: AccountRole })[]>("SELECT role FROM user_account WHERE id = ? AND status = 'active'", [configuration.actorId]);
    const role = rows[0]?.role;
    if (role !== "owner" && role !== "member") throw new SyncAccessDenied();
    if (role !== "owner" && await readUserProjectScope(connection, configuration.actorId) !== null) throw new SyncAccessDenied();
    const permissions = await listUserPermissionCodes(connection, configuration.actorId);
    if (!( ["tasks.read", "tasks.write", "customers.read", "projects.read"] as const).every(permission => hasPermission({ role, permissions }, permission))) throw new SyncAccessDenied();
  });
}

export type SyncResult = {
  status: "pending_mapping" | "processing" | "synced";
  analysisId: string; completed: number; total: number; retryAfterSeconds?: number;
};

// Each request advances one bounded batch. The durable sender retains the
// envelope and retries 202 until every step is linked; no in-memory worker.
export async function advanceAutomaticTransfer(pool: Pool, id: string, configuration: SyncConfiguration, correlationId: string): Promise<SyncResult> {
  await assertSyncActor(pool, configuration);
  let preview = await openTransfer(pool, id);
  if (preview.envelope.instanceId !== configuration.instanceId || preview.envelope.accountId !== configuration.accountId) throw new SyncAccessDenied();
  const keys = preview.envelope.programs.flatMap(program => program.steps.map(step => stepKey(program, step)));
  const report = (status: SyncResult["status"]): SyncResult => ({ status, analysisId: id, completed: preview.imported.length, total: keys.length,
    ...(status === "synced" ? {} : { retryAfterSeconds: status === "pending_mapping" ? 300 : 60 }) });
  if (preview.imported.length === keys.length) return report("synced");
  if (!preview.automation.requested || !preview.automation.approved || !preview.mapping) return report("pending_mapping");
  const existing = new Set(preview.imported.map(item => item.key));
  const selected = keys.filter(key => !existing.has(key)).slice(0, 25);
  try {
    const results = await importTransfer(pool, { action: "import", id, digest: preview.digest, ...preview.mapping, selected },
      { actorId: configuration.actorId, correlationId });
    preview = await openTransfer(pool, id);
    if (results.some(item => item.error === "mapping_changed")) return report("pending_mapping");
    return report(preview.imported.length === keys.length ? "synced" : "processing");
  } catch (error) {
    if (error instanceof TransferConflict && error.code === "mapping_changed") return report("pending_mapping");
    throw error;
  }
}

export async function receiveAutomaticTransfer(pool: Pool, envelope: Envelope, configuration: SyncConfiguration, correlationId: string): Promise<SyncResult> {
  if (envelope.instanceId !== configuration.instanceId || envelope.accountId !== configuration.accountId) throw new SyncAccessDenied();
  await assertSyncActor(pool, configuration);
  const preview = await receiveTransfer(pool, envelope, { actorId: configuration.actorId, correlationId }, true);
  return advanceAutomaticTransfer(pool, preview.id, configuration, correlationId);
}
