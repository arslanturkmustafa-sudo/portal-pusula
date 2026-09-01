import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  type CreateCustomerInput,
  createCustomerInputSchema,
  type UpdateCustomerInput,
  updateCustomerInputSchema,
} from "@/features/customers/validation";
import {
  type Customer,
  findCustomerForUpdate,
  insertCustomerRecord,
  listCustomerRecords,
  updateCustomerRecord,
} from "@/features/customers/repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class CustomerShortCodeConflictError extends Error {
  constructor() {
    super("Customer short code is already in use.");
    this.name = "CustomerShortCodeConflictError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor() {
    super("Customer was not found.");
    this.name = "CustomerNotFoundError";
  }
}

export type CustomerWriteContext = Readonly<{
  correlationId: string;
  now?: Date;
}>;

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function auditSummary(customer: Customer) {
  return {
    displayName: customer.displayName,
    shortCode: customer.shortCode,
    status: customer.status,
  };
}

export async function listCustomers(pool: Pool): Promise<readonly Customer[]> {
  return withUtcTransaction(pool, listCustomerRecords);
}

export async function createCustomer(
  pool: Pool,
  rawInput: CreateCustomerInput,
  context: CustomerWriteContext,
): Promise<Customer> {
  const input = createCustomerInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());
  const customer: Customer = {
    contactNote: input.contactNote,
    createdAtUtc: now,
    displayName: input.displayName,
    email: input.email,
    id: randomUUID(),
    phone: input.phone,
    shortCode: input.shortCode,
    status: input.status,
    updatedAtUtc: now,
  };

  try {
    return await withUtcTransaction(pool, async (connection) => {
      await insertCustomerRecord(connection, customer);
      await appendAuditEvent(connection, {
        action: "customer.created",
        actorType: "user",
        afterSummary: auditSummary(customer),
        correlationId: context.correlationId,
        entityId: customer.id,
        entityType: "customer",
        occurredAtUtc: now,
      });
      return customer;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new CustomerShortCodeConflictError();
    throw error;
  }
}

export async function updateCustomer(
  pool: Pool,
  id: string,
  rawInput: UpdateCustomerInput,
  context: CustomerWriteContext,
): Promise<Customer> {
  assertCanonicalUuid(id);
  const input = updateCustomerInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  try {
    return await withUtcTransaction(pool, async (connection) => {
      const before = await findCustomerForUpdate(connection, id);
      if (!before) throw new CustomerNotFoundError();

      const after: Customer = {
        ...before,
        ...input,
        updatedAtUtc: now,
      };
      await updateCustomerRecord(connection, after);
      await appendAuditEvent(connection, {
        action: "customer.updated",
        actorType: "user",
        afterSummary: auditSummary(after),
        beforeSummary: auditSummary(before),
        correlationId: context.correlationId,
        entityId: after.id,
        entityType: "customer",
        occurredAtUtc: now,
      });
      return after;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new CustomerShortCodeConflictError();
    throw error;
  }
}
