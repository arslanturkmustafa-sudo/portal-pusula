import "server-only";

import type { Pool } from "mysql2/promise";

import {
  contractHasLifecycleDependencies,
  findOwnedContractForUpdate,
  type ConsultingContract,
  updateContractRecord,
} from "@/features/contracts/repository";
import {
  ContractResourceNotFoundError,
  ContractVersionConflictError,
} from "@/features/contracts/service";
import { findCustomerForUpdate } from "@/features/customers/repository";
import {
  LifecycleDependencyConflictError,
  type LifecycleCommandInput,
  lifecycleCommandInputSchema,
  LifecycleParentUnavailableError,
  LifecycleStateConflictError,
} from "@/features/lifecycle";
import { findProjectForUpdate } from "@/features/projects/repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export type ContractLifecycleContext = Readonly<{
  actorId: string;
  correlationId: string;
  now?: Date;
}>;

function summary(contract: ConsultingContract) {
  return {
    archivedAtUtc: contract.archivedAtUtc,
    archivedByUserAccountId: contract.archivedByUserAccountId,
    status: contract.status,
    version: contract.version,
  };
}

export async function changeContractLifecycle(
  pool: Pool,
  customerId: string,
  contractId: string,
  rawInput: LifecycleCommandInput,
  context: ContractLifecycleContext,
): Promise<ConsultingContract> {
  assertCanonicalUuid(customerId);
  assertCanonicalUuid(contractId);
  assertCanonicalUuid(context.actorId);
  const input = lifecycleCommandInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const customer = await findCustomerForUpdate(connection, customerId);
    if (!customer) throw new ContractResourceNotFoundError();
    const before = await findOwnedContractForUpdate(
      connection,
      customerId,
      contractId,
    );
    if (!before) throw new ContractResourceNotFoundError();
    if (before.version !== input.version) {
      throw new ContractVersionConflictError();
    }

    if (input.action === "archive") {
      if (before.archivedAtUtc !== null || before.status !== "closed") {
        throw new LifecycleStateConflictError();
      }
      if (await contractHasLifecycleDependencies(connection, contractId)) {
        throw new LifecycleDependencyConflictError();
      }
    } else {
      if (before.archivedAtUtc === null) {
        throw new LifecycleStateConflictError();
      }
      if (customer.archivedAtUtc !== null) {
        throw new LifecycleParentUnavailableError();
      }
      if (before.projectId !== null) {
        const project = await findProjectForUpdate(connection, before.projectId);
        if (!project || project.archivedAtUtc !== null) {
          throw new LifecycleParentUnavailableError();
        }
      }
    }

    const after: ConsultingContract = {
      ...before,
      archiveReason: input.action === "archive" ? input.reason! : null,
      archivedAtUtc: input.action === "archive" ? now : null,
      archivedByUserAccountId:
        input.action === "archive" ? context.actorId : null,
      updatedAtUtc: now,
      version: before.version + 1,
    };
    if (!(await updateContractRecord(connection, after, input.version))) {
      throw new ContractVersionConflictError();
    }
    await appendAuditEvent(connection, {
      action: `consulting_contract.${input.action}d`,
      actorId: context.actorId,
      actorType: "user",
      afterSummary: { ...summary(after), reason: input.reason ?? null },
      beforeSummary: summary(before),
      correlationId: context.correlationId,
      entityId: contractId,
      entityType: "consulting_contract",
      occurredAtUtc: now,
    });
    return after;
  });
}
