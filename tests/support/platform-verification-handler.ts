import { appendAuditEvent } from "../../src/platform/audit";
import { enqueueOutboxEvent } from "../../src/platform/outbox/repository";
import {
  SafeJobHandlerError,
  type JobHandler,
} from "../../src/platform/jobs/types";

export const VERIFICATION_JOB_TYPE = "platform.verification.v1";
export const VERIFICATION_EVENT_TYPE =
  "platform.verification.completed.v1";

/** Test-only fixture; production source, registry, and ZIP never import it. */
export function createVerificationJobHandler(
  options: Readonly<{ failAfterEffects?: boolean }> = {},
): JobHandler {
  return async ({ connection, job, occurredAtUtc }) => {
    await appendAuditEvent(connection, {
      action: "platform.verification.completed",
      actorType: "system",
      afterSummary: { status: "verified" },
      correlationId: job.correlationId,
      entityId: job.id,
      entityType: "platform_job",
      occurredAtUtc,
    });
    await enqueueOutboxEvent(connection, {
      availableAtUtc: occurredAtUtc,
      eventType: VERIFICATION_EVENT_TYPE,
      idempotencyKey: `verification:${job.id}:completed`,
      maxAttempts: 3,
      payload: { jobId: job.id, status: "verified" },
      schemaVersion: 1,
    });

    if (options.failAfterEffects) {
      throw new SafeJobHandlerError("platform_operation_failed");
    }
  };
}
