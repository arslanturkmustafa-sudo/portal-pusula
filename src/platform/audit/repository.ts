import "server-only";

import { randomUUID } from "node:crypto";

import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

import {
  assertCanonicalAsciiKey,
  assertCanonicalUuid,
} from "@/platform/validation/canonical-identifiers";

export type AuditActorType = "system" | "user";

export type AppendAuditEventInput = Readonly<{
  action: string;
  actorId?: string;
  actorType: AuditActorType;
  afterSummary?: unknown;
  beforeSummary?: unknown;
  correlationId: string;
  entityId: string;
  entityType: string;
  id?: string;
  occurredAtUtc: string;
}>;

function serializedSummary(value: unknown | undefined): string | null {
  if (value === undefined) return null;

  try {
    return JSON.stringify(value);
  } catch {
    throw new Error("Audit summary is not serializable.");
  }
}

/**
 * The only audit persistence API. Deliberately no update or delete operation is
 * exported; database-trigger enforcement remains outside the proven Hostinger
 * privilege boundary.
 */
export async function appendAuditEvent(
  connection: PoolConnection,
  input: AppendAuditEventInput,
): Promise<string> {
  const id =
    input.id === undefined ? randomUUID() : assertCanonicalUuid(input.id);
  if (input.actorId !== undefined) assertCanonicalUuid(input.actorId);
  assertCanonicalUuid(input.entityId);
  assertCanonicalAsciiKey(input.action, 128);
  assertCanonicalAsciiKey(input.entityType, 128);
  assertCanonicalAsciiKey(input.correlationId, 64);

  if (input.actorType !== "system" && input.actorType !== "user") {
    throw new Error("Audit actor type is invalid.");
  }
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO audit_event
       (id, actor_type, actor_id, action, entity_type, entity_id,
        before_summary, after_summary, correlation_id, occurred_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      serializedSummary(input.beforeSummary),
      serializedSummary(input.afterSummary),
      input.correlationId,
      input.occurredAtUtc,
    ],
  );

  if (result.affectedRows !== 1) {
    throw new Error("Audit append failed.");
  }

  return id;
}
