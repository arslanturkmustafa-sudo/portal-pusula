// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findByDisplayName: vi.fn(),
  findByOperation: vi.fn(),
  insert: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/features/finance/expense-category-repository", () => ({
  findExpenseCategoryByDisplayNameForUpdate: mocks.findByDisplayName,
  findExpenseCategoryByOperationKeyForUpdate: mocks.findByOperation,
  insertExpenseCategoryRecordIdempotently: mocks.insert,
  listExpenseCategoryRecords: mocks.list,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcConsistentRead: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  createExpenseCategory,
  ExpenseCategoryAlreadyExistsError,
  ExpenseCategoryIdempotencyConflictError,
  listExpenseCategories,
} from "./expense-category-service";

const operationKey = "30000000-0000-4000-8000-000000000001";
const context = {
  correlationId: "expense-category-test",
  now: new Date("2026-09-07T09:00:00.000Z"),
};

describe("expense category service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByOperation.mockResolvedValue(null);
    mocks.findByDisplayName.mockResolvedValue(null);
    mocks.insert.mockImplementation(async (_connection, pending) => pending);
  });

  it("lists only the public category view", async () => {
    mocks.list.mockResolvedValue([
      {
        clientOperationKey: operationKey,
        code: "rent",
        createdAtUtc: "2026-09-07 09:00:00.000000",
        displayName: "Kira",
        id: "10000000-0000-4000-8000-000000000001",
        isSystem: true,
        status: "active",
        updatedAtUtc: "2026-09-07 09:00:00.000000",
        version: 1,
      },
    ]);
    await expect(listExpenseCategories({} as Pool)).resolves.toEqual({
      categories: [
        {
          code: "rent",
          displayName: "Kira",
          id: "10000000-0000-4000-8000-000000000001",
          isSystem: true,
        },
      ],
    });
  });

  it("creates an audited custom category with a server-generated code", async () => {
    const result = await createExpenseCategory(
      {} as Pool,
      { clientOperationKey: operationKey, displayName: "Eğitim materyali" },
      context,
    );
    expect(result.created).toBe(true);
    expect(result.category).toMatchObject({
      displayName: "Eğitim materyali",
      isSystem: false,
    });
    expect(result.category.code).toMatch(/^custom_[0-9a-f]{25}$/u);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "expense_category.created",
        entityId: result.category.id,
        entityType: "expense_category",
      }),
    );
  });

  it("rejects duplicate names and conflicting operation-key replays", async () => {
    mocks.findByDisplayName.mockResolvedValueOnce({ id: "existing" });
    await expect(
      createExpenseCategory(
        {} as Pool,
        { clientOperationKey: operationKey, displayName: "Kira" },
        context,
      ),
    ).rejects.toBeInstanceOf(ExpenseCategoryAlreadyExistsError);

    mocks.findByOperation.mockResolvedValueOnce({
      clientOperationKey: operationKey,
      displayName: "Başka kategori",
    });
    await expect(
      createExpenseCategory(
        {} as Pool,
        { clientOperationKey: operationKey, displayName: "Eğitim" },
        context,
      ),
    ).rejects.toBeInstanceOf(ExpenseCategoryIdempotencyConflictError);
  });

  it("maps a concurrent case-insensitive name collision to the public conflict", async () => {
    mocks.findByDisplayName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "concurrent-category" });
    mocks.insert.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    await expect(
      createExpenseCategory(
        {} as Pool,
        { clientOperationKey: operationKey, displayName: "Eğitim" },
        context,
      ),
    ).rejects.toBeInstanceOf(ExpenseCategoryAlreadyExistsError);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("returns a concurrent operation-key replay without a second audit", async () => {
    const concurrent = {
      clientOperationKey: operationKey,
      code: "custom_3000000000004000800000000",
      createdAtUtc: "2026-09-07 09:00:00.000000",
      displayName: "Eğitim",
      id: "30000000-0000-4000-8000-000000000002",
      isSystem: false,
      status: "active",
      updatedAtUtc: "2026-09-07 09:00:00.000000",
      version: 1,
    } as const;
    mocks.findByOperation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrent);
    mocks.insert.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    await expect(
      createExpenseCategory(
        {} as Pool,
        { clientOperationKey: operationKey, displayName: "Eğitim" },
        context,
      ),
    ).resolves.toEqual({
      category: {
        code: concurrent.code,
        displayName: concurrent.displayName,
        id: concurrent.id,
        isSystem: false,
      },
      created: false,
    });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
