import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool } from "mysql2/promise";

import { istanbulDate } from "@/features/finance/period";
import {
  calculateVatSourceSnapshot,
  findTaxObligationByOperationKeyForUpdate,
  findTaxObligationByTypePeriodForUpdate,
  findTaxObligationForUpdate,
  insertTaxObligationRecordIdempotently,
  listTaxObligationRecords,
  type TaxObligationRecord,
  TaxObligationPeriodCollisionError,
  type VatSourceSnapshot,
  updateTaxObligationRecord,
} from "@/features/finance/tax-repository";
import {
  type CreateTaxObligationInput,
  createTaxObligationInputSchema,
  type TaxListFilter,
  taxListFilterSchema,
  type UpdateTaxObligationInput,
  updateTaxObligationInputSchema,
} from "@/features/finance/tax-validation";
import { appendAuditEvent } from "@/platform/audit/repository";
import {
  withUtcConsistentRead,
  withUtcTransaction,
} from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

const ZERO = "0.0000";
const MAX_MONEY = new Decimal("999999999999999.9999");

export class TaxObligationNotFoundError extends Error {
  constructor() {
    super("The requested tax obligation was not found.");
    this.name = "TaxObligationNotFoundError";
  }
}

export class TaxObligationVersionConflictError extends Error {
  constructor() {
    super("The tax obligation was changed by another request.");
    this.name = "TaxObligationVersionConflictError";
  }
}

export class TaxObligationIdempotencyConflictError extends Error {
  constructor() {
    super("The client operation key is already bound to another tax request.");
    this.name = "TaxObligationIdempotencyConflictError";
  }
}

export class TaxObligationTypeConflictError extends Error {
  constructor() {
    super("The tax obligation type cannot be changed.");
    this.name = "TaxObligationTypeConflictError";
  }
}

export class TaxObligationPeriodConflictError extends Error {
  constructor() {
    super("A tax obligation already exists for this type and period.");
    this.name = "TaxObligationPeriodConflictError";
  }
}

export class TaxPaymentDateInFutureError extends Error {
  constructor() {
    super("The tax payment date cannot be in the future.");
    this.name = "TaxPaymentDateInFutureError";
  }
}

export type TaxWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

export type TaxView = Readonly<{
  accountantAmount: string | null;
  carriedVatCreditAmount: string;
  closingVatCreditAmount: string;
  currency: "TRY";
  description: string;
  dueOn: string;
  id: string;
  manualAdjustmentAmount: string;
  note: string | null;
  paidOn: string | null;
  payableAmount: string;
  periodMonth: string;
  status: "paid" | "planned" | "voided";
  systemInputVatAmount: string;
  systemNetVatAmount: string;
  systemOutputVatAmount: string;
  taxType: "income_tax" | "provisional_tax" | "vat";
  version: number;
}>;

export type VatEstimate = Readonly<{
  basis: Readonly<{
    input: "active_expense_incurred_period";
    openingBalancesIncluded: false;
    output: "active_contract_receivable_period";
  }>;
  periodMonth: string;
  sourceExpenseCount: number;
  sourceReceivableCount: number;
  systemInputVatAmount: string;
  systemNetVatAmount: string;
  systemOutputVatAmount: string;
}>;

export type TaxOverview = Readonly<{
  selectedPeriodMonth: string;
  summary: Readonly<{
    closingVatCreditAmount: string;
    currency: "TRY";
    overdueAmount: string;
    paidAmount: string;
    plannedAmount: string;
  }>;
  taxes: readonly TaxView[];
  vatEstimate: VatEstimate;
}>;

function fixedMoney(value: Decimal.Value): string {
  const amount = new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  if (amount.abs().greaterThan(MAX_MONEY)) {
    throw new RangeError("Money value exceeds DECIMAL(19,4).");
  }
  return amount.toFixed(4);
}

function systemNetVat(
  source: Pick<
    TaxObligationRecord,
    "systemInputVatAmount" | "systemOutputVatAmount"
  >,
): string {
  return fixedMoney(
    new Decimal(source.systemOutputVatAmount).minus(
      source.systemInputVatAmount,
    ),
  );
}

function vatAmounts(
  snapshot: VatSourceSnapshot,
  carriedVatCreditAmount: string,
  manualAdjustmentAmount: string,
) {
  const adjusted = new Decimal(snapshot.systemOutputVatAmount)
    .minus(snapshot.systemInputVatAmount)
    .minus(carriedVatCreditAmount)
    .plus(manualAdjustmentAmount);
  return {
    carriedVatCreditAmount,
    closingVatCreditAmount: fixedMoney(Decimal.max(adjusted.negated(), 0)),
    manualAdjustmentAmount,
    payableAmount: fixedMoney(Decimal.max(adjusted, 0)),
    systemInputVatAmount: fixedMoney(snapshot.systemInputVatAmount),
    systemOutputVatAmount: fixedMoney(snapshot.systemOutputVatAmount),
  };
}

function nonVatAmounts(accountantAmount: string) {
  return {
    carriedVatCreditAmount: ZERO,
    closingVatCreditAmount: ZERO,
    manualAdjustmentAmount: ZERO,
    payableAmount: accountantAmount,
    systemInputVatAmount: ZERO,
    systemOutputVatAmount: ZERO,
  };
}

function taxView(tax: TaxObligationRecord): TaxView {
  return {
    accountantAmount: tax.taxType === "vat" ? null : tax.payableAmount,
    carriedVatCreditAmount: tax.carriedVatCreditAmount,
    closingVatCreditAmount: tax.closingVatCreditAmount,
    currency: "TRY",
    description: tax.description,
    dueOn: tax.dueOn,
    id: tax.id,
    manualAdjustmentAmount: tax.manualAdjustmentAmount,
    note: tax.note,
    paidOn: tax.paidOn,
    payableAmount: tax.payableAmount,
    periodMonth: tax.periodMonth,
    status: tax.status,
    systemInputVatAmount: tax.systemInputVatAmount,
    systemNetVatAmount: systemNetVat(tax),
    systemOutputVatAmount: tax.systemOutputVatAmount,
    taxType: tax.taxType,
    version: tax.version,
  };
}

function vatEstimate(periodMonth: string, snapshot: VatSourceSnapshot): VatEstimate {
  return {
    basis: {
      input: "active_expense_incurred_period",
      openingBalancesIncluded: false,
      output: "active_contract_receivable_period",
    },
    periodMonth,
    sourceExpenseCount: snapshot.sourceExpenseCount,
    sourceReceivableCount: snapshot.sourceReceivableCount,
    systemInputVatAmount: fixedMoney(snapshot.systemInputVatAmount),
    systemNetVatAmount: fixedMoney(
      new Decimal(snapshot.systemOutputVatAmount).minus(
        snapshot.systemInputVatAmount,
      ),
    ),
    systemOutputVatAmount: fixedMoney(snapshot.systemOutputVatAmount),
  };
}

function recordAmounts(
  input: CreateTaxObligationInput | UpdateTaxObligationInput,
  snapshot: VatSourceSnapshot | null,
) {
  if (input.taxType === "vat") {
    if (!snapshot) throw new Error("VAT source snapshot is missing.");
    return vatAmounts(
      snapshot,
      input.carriedVatCreditAmount,
      input.manualAdjustmentAmount,
    );
  }
  return nonVatAmounts(input.accountantAmount);
}

function taxMatchesInput(
  tax: TaxObligationRecord,
  input: CreateTaxObligationInput,
): boolean {
  return (
    tax.clientOperationKey === input.clientOperationKey &&
    tax.taxType === input.taxType &&
    tax.periodMonth === input.periodMonth &&
    tax.description === input.description &&
    tax.dueOn === input.dueOn &&
    tax.note === input.note &&
    tax.status === input.status &&
    tax.paidOn === input.paidOn &&
    tax.voidReason === input.voidReason &&
    (input.taxType === "vat"
      ? tax.carriedVatCreditAmount === input.carriedVatCreditAmount &&
        tax.manualAdjustmentAmount === input.manualAdjustmentAmount
      : tax.payableAmount === input.accountantAmount)
  );
}

function taxAuditSummary(tax: TaxObligationRecord) {
  return {
    carriedVatCreditAmount: tax.carriedVatCreditAmount,
    closingVatCreditAmount: tax.closingVatCreditAmount,
    dueOn: tax.dueOn,
    manualAdjustmentAmount: tax.manualAdjustmentAmount,
    paidOn: tax.paidOn,
    payableAmount: tax.payableAmount,
    periodMonth: tax.periodMonth,
    status: tax.status,
    systemInputVatAmount: tax.systemInputVatAmount,
    systemOutputVatAmount: tax.systemOutputVatAmount,
    taxType: tax.taxType,
    version: tax.version,
    voidReason: tax.voidReason,
  };
}

function validatePaymentDate(
  input: CreateTaxObligationInput | UpdateTaxObligationInput,
  now: Date,
): void {
  if (input.paidOn !== null && input.paidOn > istanbulDate(now)) {
    throw new TaxPaymentDateInFutureError();
  }
}

function validatePayableState(
  status: TaxObligationRecord["status"],
  payableAmount: string,
): void {
  if (status === "paid" && new Decimal(payableAmount).isZero()) {
    throw new RangeError("A zero tax liability cannot be marked as paid.");
  }
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function summarizeTaxes(
  records: readonly TaxObligationRecord[],
  selectedPeriodMonth: string,
  estimate: VatEstimate,
  today: string,
): TaxOverview["summary"] {
  let overdueAmount = new Decimal(0);
  let paidAmount = new Decimal(0);
  let plannedAmount = new Decimal(0);
  for (const record of records) {
    if (record.status === "voided") continue;
    if (record.status === "paid") {
      paidAmount = paidAmount.plus(record.payableAmount);
    } else if (record.dueOn < today) {
      overdueAmount = overdueAmount.plus(record.payableAmount);
    } else {
      plannedAmount = plannedAmount.plus(record.payableAmount);
    }
  }
  const selectedVat = records.find(
    (record) =>
      record.taxType === "vat" &&
      record.periodMonth === selectedPeriodMonth &&
      record.status !== "voided",
  );
  const estimatedCredit = Decimal.max(
    new Decimal(estimate.systemNetVatAmount).negated(),
    0,
  );
  return {
    closingVatCreditAmount:
      selectedVat?.closingVatCreditAmount ?? fixedMoney(estimatedCredit),
    currency: "TRY",
    overdueAmount: fixedMoney(overdueAmount),
    paidAmount: fixedMoney(paidAmount),
    plannedAmount: fixedMoney(plannedAmount),
  };
}

export async function listTaxesOverview(
  pool: Pool,
  rawFilters: TaxListFilter,
  now = new Date(),
): Promise<TaxOverview> {
  const filters = taxListFilterSchema.parse(rawFilters);
  const selectedPeriodMonth =
    filters.periodMonth ?? istanbulDate(now).slice(0, 7);
  return withUtcConsistentRead(pool, async (connection) => {
    const [records, snapshot] = await Promise.all([
      listTaxObligationRecords(connection, selectedPeriodMonth),
      calculateVatSourceSnapshot(connection, selectedPeriodMonth),
    ]);
    const estimate = vatEstimate(selectedPeriodMonth, snapshot);
    return {
      selectedPeriodMonth,
      summary: summarizeTaxes(
        records,
        selectedPeriodMonth,
        estimate,
        istanbulDate(now),
      ),
      taxes: records.map(taxView),
      vatEstimate: estimate,
    };
  });
}

export async function createTaxObligation(
  pool: Pool,
  rawInput: CreateTaxObligationInput,
  context: TaxWriteContext,
): Promise<Readonly<{ created: boolean; tax: TaxView }>> {
  const input = createTaxObligationInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  validatePaymentDate(input, nowDate);
  const now = toUtcDateTime6(nowDate);
  return withUtcTransaction(pool, async (connection) => {
    const replay = await findTaxObligationByOperationKeyForUpdate(
      connection,
      input.clientOperationKey,
    );
    if (replay && !taxMatchesInput(replay, input)) {
      throw new TaxObligationIdempotencyConflictError();
    }
    if (replay) return { created: false, tax: taxView(replay) };
    if (
      await findTaxObligationByTypePeriodForUpdate(
        connection,
        input.taxType,
        input.periodMonth,
      )
    ) {
      throw new TaxObligationPeriodConflictError();
    }
    const snapshot =
      input.taxType === "vat"
        ? await calculateVatSourceSnapshot(connection, input.periodMonth)
        : null;
    const amounts = recordAmounts(input, snapshot);
    validatePayableState(input.status, amounts.payableAmount);
    const pending: TaxObligationRecord = {
      ...amounts,
      clientOperationKey: input.clientOperationKey,
      createdAtUtc: now,
      currency: "TRY",
      description: input.description,
      dueOn: input.dueOn,
      id: randomUUID(),
      note: input.note,
      paidOn: input.paidOn,
      periodMonth: input.periodMonth,
      status: input.status,
      taxType: input.taxType,
      updatedAtUtc: now,
      version: 1,
      voidedAtUtc: input.status === "voided" ? now : null,
      voidReason: input.voidReason,
    };
    let persisted: TaxObligationRecord;
    try {
      persisted = await insertTaxObligationRecordIdempotently(
        connection,
        pending,
      );
    } catch (error) {
      if (error instanceof TaxObligationPeriodCollisionError) {
        throw new TaxObligationPeriodConflictError();
      }
      throw error;
    }
    if (!taxMatchesInput(persisted, input)) {
      throw new TaxObligationIdempotencyConflictError();
    }
    const created = persisted.id === pending.id;
    if (created) {
      await appendAuditEvent(connection, {
        action: "tax_obligation.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: taxAuditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "tax_obligation",
        occurredAtUtc: now,
      });
    }
    return { created, tax: taxView(persisted) };
  });
}

export async function updateTaxObligation(
  pool: Pool,
  id: string,
  rawInput: UpdateTaxObligationInput,
  context: TaxWriteContext,
): Promise<TaxView> {
  assertCanonicalUuid(id);
  const input = updateTaxObligationInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const nowDate = context.now ?? new Date();
  validatePaymentDate(input, nowDate);
  const now = toUtcDateTime6(nowDate);
  return withUtcTransaction(pool, async (connection) => {
    const before = await findTaxObligationForUpdate(connection, id);
    if (!before) throw new TaxObligationNotFoundError();
    if (before.taxType !== input.taxType) {
      throw new TaxObligationTypeConflictError();
    }
    if (before.version !== input.version) {
      throw new TaxObligationVersionConflictError();
    }
    const periodRecord = await findTaxObligationByTypePeriodForUpdate(
      connection,
      input.taxType,
      input.periodMonth,
    );
    if (periodRecord && periodRecord.id !== before.id) {
      throw new TaxObligationPeriodConflictError();
    }
    const snapshot =
      input.taxType === "vat"
        ? await calculateVatSourceSnapshot(connection, input.periodMonth)
        : null;
    const amounts = recordAmounts(input, snapshot);
    validatePayableState(input.status, amounts.payableAmount);
    const after: TaxObligationRecord = {
      ...before,
      ...amounts,
      description: input.description,
      dueOn: input.dueOn,
      note: input.note,
      paidOn: input.paidOn,
      periodMonth: input.periodMonth,
      status: input.status,
      updatedAtUtc: now,
      version: before.version + 1,
      voidedAtUtc: input.status === "voided" ? now : null,
      voidReason: input.voidReason,
    };
    try {
      if (!(await updateTaxObligationRecord(connection, after, input.version))) {
        throw new TaxObligationVersionConflictError();
      }
    } catch (error) {
      if (isDuplicateEntry(error)) throw new TaxObligationPeriodConflictError();
      throw error;
    }
    await appendAuditEvent(connection, {
      action:
        after.status === "paid" && before.status !== "paid"
          ? "tax_obligation.paid"
          : after.status === "voided"
            ? "tax_obligation.voided"
            : "tax_obligation.updated",
      actorId: context.actorId,
      actorType: "user",
      afterSummary: taxAuditSummary(after),
      beforeSummary: taxAuditSummary(before),
      correlationId: context.correlationId,
      entityId: after.id,
      entityType: "tax_obligation",
      occurredAtUtc: now,
    });
    return taxView(after);
  });
}
