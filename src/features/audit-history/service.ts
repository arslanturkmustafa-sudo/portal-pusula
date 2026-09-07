import "server-only";

import type { Pool } from "mysql2/promise";

import type { AuthenticatedPrincipal } from "@/platform/auth/server-auth";
import {
  hasPermission,
  type PermissionCode,
} from "@/platform/auth/permissions";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

import { listAuditHistoryRows } from "./repository";

const entityPermissions = {
  consulting_contract: "contracts.read",
  customer: "customers.read",
  expense: "finance.expenses.read",
  finance_account: "finance.accounts.read",
  finance_transaction: "finance.accounts.read",
  partnership_contribution: "finance.partnership.read",
  partnership_contribution_receipt: "finance.partnership.read",
  partnership_commission: "finance.partnership.read",
  project: "projects.read",
  receivable: "finance.receivables.read",
  receivable_collection: "finance.receivables.read",
  work_task: "tasks.read",
} as const satisfies Readonly<Record<string, PermissionCode>>;

export type AuditEntityType = keyof typeof entityPermissions;

export type AuditHistoryEvent = Readonly<{
  action: string;
  actorLabel: string;
  after: Readonly<Record<string, AuditSummaryValue>> | null;
  before: Readonly<Record<string, AuditSummaryValue>> | null;
  id: string;
  occurredAtUtc: string;
}>;

type AuditSummaryValue = boolean | number | string | null | readonly string[];

const commonKeys = new Set([
  "action",
  "completedAtUtc",
  "createdAtUtc",
  "customerId",
  "description",
  "displayName",
  "dueOn",
  "endsOn",
  "entityVersion",
  "incurredOn",
  "projectId",
  "projectIds",
  "projectType",
  "reason",
  "shortCode",
  "startsOn",
  "status",
  "title",
  "updatedAtUtc",
  "version",
]);

const entityKeys: Readonly<Record<AuditEntityType, ReadonlySet<string>>> = {
  consulting_contract: new Set([
    ...commonKeys,
    "paymentDay",
    "vatMode",
    "vatRate",
    "monthlyFeeAmount",
  ]),
  customer: commonKeys,
  expense: new Set([
    ...commonKeys,
    "category",
    "creditCardId",
    "netAmount",
    "paymentMethod",
    "totalAmount",
    "vatAmount",
    "voidReason",
  ]),
  finance_account: new Set([
    "accountType",
    "bankName",
    "displayName",
    "openingBalanceAmount",
    "status",
    "version",
  ]),
  finance_transaction: new Set([
    "amount",
    "description",
    "occurredOn",
    "reversalId",
    "reversalOfId",
    "reversalReason",
    "sourceAccountId",
    "targetAccountId",
    "transactionType",
  ]),
  partnership_contribution: new Set([
    ...commonKeys,
    "contributionMonth",
    "expectedAmount",
    "receivedAmount",
    "receivedOn",
  ]),
  partnership_contribution_receipt: new Set([
    ...commonKeys,
    "amount",
    "contributionId",
    "receivedOn",
    "reversalOfId",
  ]),
  partnership_commission: new Set([
    ...commonKeys,
    "commissionBasisAmount",
    "contributionMode",
    "paidOn",
    "shareAmount",
    "shareRate",
    "transactionType",
  ]),
  project: commonKeys,
  receivable: new Set([
    ...commonKeys,
    "collectedAmount",
    "collectedOn",
    "contractId",
    "netAmount",
    "outstandingAmount",
    "periodMonth",
    "recordState",
    "sourceType",
    "totalAmount",
    "vatAmount",
  ]),
  receivable_collection: new Set([
    ...commonKeys,
    "amount",
    "collectedAmount",
    "collectedOn",
    "outstandingAmount",
    "originalCollectionId",
    "receivableId",
  ]),
  work_task: new Set([
    ...commonKeys,
    "assigneeUserAccountId",
    "priority",
  ]),
};

const contractBillingKeys = new Set([
  "monthlyFeeAmount",
  "paymentDay",
  "vatMode",
  "vatRate",
]);

export class AuditHistoryForbiddenError extends Error {
  constructor() {
    super("Audit history is not available for this principal.");
    this.name = "AuditHistoryForbiddenError";
  }
}

export function isAuditEntityType(value: string): value is AuditEntityType {
  return Object.hasOwn(entityPermissions, value);
}

function safeValue(value: unknown): AuditSummaryValue | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 2_000);
  if (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => typeof item === "string")
  ) {
    return value.map((item) => item.slice(0, 191));
  }
  return undefined;
}

export function redactAuditSummary(
  entityType: AuditEntityType,
  summary: unknown,
  principal: AuthenticatedPrincipal,
): Readonly<Record<string, AuditSummaryValue>> | null {
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    return null;
  }

  const redacted: Record<string, AuditSummaryValue> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (!entityKeys[entityType].has(key)) continue;
    if (
      entityType === "consulting_contract" &&
      contractBillingKeys.has(key) &&
      !hasPermission(principal, "contracts.billing.read")
    ) {
      continue;
    }
    const safe = safeValue(value);
    if (safe !== undefined) redacted[key] = safe;
  }
  return Object.keys(redacted).length > 0 ? redacted : null;
}

export async function getAuditHistory(
  pool: Pool,
  entityType: AuditEntityType,
  entityId: string,
  principal: AuthenticatedPrincipal,
): Promise<readonly AuditHistoryEvent[]> {
  assertCanonicalUuid(entityId);
  if (
    !hasPermission(principal, "audit.read") ||
    !hasPermission(principal, entityPermissions[entityType])
  ) {
    throw new AuditHistoryForbiddenError();
  }

  const rows = await listAuditHistoryRows(pool, entityType, entityId);
  return rows.map((row) => ({
    action: row.action,
    actorLabel:
      row.actorType === "system"
        ? "Sistem"
        : (row.actorDisplayName ?? "Ekip üyesi"),
    after: redactAuditSummary(entityType, row.afterSummary, principal),
    before: redactAuditSummary(entityType, row.beforeSummary, principal),
    id: row.id,
    occurredAtUtc: row.occurredAtUtc,
  }));
}
