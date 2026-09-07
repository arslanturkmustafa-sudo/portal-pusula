import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  type ExpenseCategoryRecord,
  findExpenseCategoryByDisplayNameForUpdate,
  findExpenseCategoryByOperationKeyForUpdate,
  insertExpenseCategoryRecordIdempotently,
  listExpenseCategoryRecords,
} from "@/features/finance/expense-category-repository";
import {
  type CreateExpenseCategoryInput,
  createExpenseCategoryInputSchema,
} from "@/features/finance/expense-category-validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import {
  withUtcConsistentRead,
  withUtcTransaction,
} from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class ExpenseCategoryIdempotencyConflictError extends Error {
  constructor() {
    super("The client operation key is already bound to another category.");
    this.name = "ExpenseCategoryIdempotencyConflictError";
  }
}

export class ExpenseCategoryAlreadyExistsError extends Error {
  constructor() {
    super("An expense category with the same name already exists.");
    this.name = "ExpenseCategoryAlreadyExistsError";
  }
}

export type ExpenseCategoryView = Readonly<{
  code: string;
  displayName: string;
  id: string;
  isSystem: boolean;
}>;

export type ExpenseCategoryWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

function categoryView(category: ExpenseCategoryRecord): ExpenseCategoryView {
  return {
    code: category.code,
    displayName: category.displayName,
    id: category.id,
    isSystem: category.isSystem,
  };
}

function categoryMatches(
  category: ExpenseCategoryRecord,
  input: CreateExpenseCategoryInput,
): boolean {
  return (
    category.clientOperationKey === input.clientOperationKey &&
    category.displayName === input.displayName
  );
}

function customCategoryCode(id: string): string {
  return `custom_${id.replaceAll("-", "").slice(0, 25)}`;
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

export async function listExpenseCategories(
  pool: Pool,
): Promise<Readonly<{ categories: readonly ExpenseCategoryView[] }>> {
  return withUtcConsistentRead(pool, async (connection) => ({
    categories: (await listExpenseCategoryRecords(connection)).map(categoryView),
  }));
}

export async function createExpenseCategory(
  pool: Pool,
  rawInput: CreateExpenseCategoryInput,
  context: ExpenseCategoryWriteContext,
): Promise<Readonly<{ category: ExpenseCategoryView; created: boolean }>> {
  const input = createExpenseCategoryInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());

  return withUtcTransaction(pool, async (connection) => {
    const replay = await findExpenseCategoryByOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay && !categoryMatches(replay, input)) {
      throw new ExpenseCategoryIdempotencyConflictError();
    }
    if (replay) return { category: categoryView(replay), created: false };

    if (
      await findExpenseCategoryByDisplayNameForUpdate(
        connection,
        input.displayName,
      )
    ) {
      throw new ExpenseCategoryAlreadyExistsError();
    }

    const id = randomUUID();
    const pending: ExpenseCategoryRecord = {
      clientOperationKey: input.clientOperationKey,
      code: customCategoryCode(id),
      createdAtUtc: now,
      displayName: input.displayName,
      id,
      isSystem: false,
      status: "active",
      updatedAtUtc: now,
      version: 1,
    };
    let persisted: ExpenseCategoryRecord;
    try {
      persisted = await insertExpenseCategoryRecordIdempotently(
        connection,
        pending,
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;

      const concurrentReplay =
        await findExpenseCategoryByOperationKeyForUpdate(
          connection,
          input.clientOperationKey,
        );
      if (concurrentReplay) {
        if (!categoryMatches(concurrentReplay, input)) {
          throw new ExpenseCategoryIdempotencyConflictError();
        }
        return {
          category: categoryView(concurrentReplay),
          created: false,
        };
      }

      if (
        await findExpenseCategoryByDisplayNameForUpdate(
          connection,
          input.displayName,
        )
      ) {
        throw new ExpenseCategoryAlreadyExistsError();
      }
      throw error;
    }
    if (!categoryMatches(persisted, input)) {
      throw new ExpenseCategoryIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      await appendAuditEvent(connection, {
        action: "expense_category.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: {
          code: persisted.code,
          displayName: persisted.displayName,
          isSystem: persisted.isSystem,
        },
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "expense_category",
        occurredAtUtc: now,
      });
    }
    return { category: categoryView(persisted), created };
  });
}
