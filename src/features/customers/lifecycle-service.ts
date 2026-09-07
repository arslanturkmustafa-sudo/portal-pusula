import "server-only";

import type { Pool } from "mysql2/promise";

import {
  customerHasLifecycleDependencies,
  findCustomerForUpdate,
  type Customer,
  updateCustomerRecord,
} from "@/features/customers/repository";
import {
  CustomerNotFoundError,
  CustomerVersionConflictError,
} from "@/features/customers/service";
import {
  LifecycleDependencyConflictError,
  type LifecycleCommandInput,
  lifecycleCommandInputSchema,
  LifecycleStateConflictError,
} from "@/features/lifecycle";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export type CustomerLifecycleContext = Readonly<{
  actorId: string;
  correlationId: string;
  now?: Date;
}>;

function summary(customer: Customer) {
  return {
    archivedAtUtc: customer.archivedAtUtc,
    archivedByUserAccountId: customer.archivedByUserAccountId,
    status: customer.status,
    version: customer.version,
  };
}

export async function changeCustomerLifecycle(
  pool: Pool,
  customerId: string,
  rawInput: LifecycleCommandInput,
  context: CustomerLifecycleContext,
): Promise<Customer> {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(context.actorId);
  const input = lifecycleCommandInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const before = await findCustomerForUpdate(connection, customerId);
    if (!before) throw new CustomerNotFoundError();
    if (before.version !== input.version) {
      throw new CustomerVersionConflictError();
    }

    if (input.action === "archive") {
      if (before.archivedAtUtc !== null || before.status !== "inactive") {
        throw new LifecycleStateConflictError();
      }
      if (await customerHasLifecycleDependencies(connection, customerId)) {
        throw new LifecycleDependencyConflictError();
      }
    } else if (before.archivedAtUtc === null) {
      throw new LifecycleStateConflictError();
    }

    const after: Customer = {
      ...before,
      archiveReason: input.action === "archive" ? input.reason! : null,
      archivedAtUtc: input.action === "archive" ? now : null,
      archivedByUserAccountId:
        input.action === "archive" ? context.actorId : null,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateCustomerRecord(connection, after, input.version))) {
      throw new CustomerVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: `customer.${input.action}d`,
      actorId: context.actorId,
      actorType: "user",
      afterSummary: { ...summary(after), reason: input.reason ?? null },
      beforeSummary: summary(before),
      correlationId: context.correlationId,
      entityId: customerId,
      entityType: "customer",
      occurredAtUtc: now,
    });
    return after;
  });
}
