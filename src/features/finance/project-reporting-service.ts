import "server-only";

import Decimal from "decimal.js";
import type { Pool } from "mysql2/promise";

import { istanbulDate, monthBounds } from "@/features/finance/period";
import {
  readProjectFinanceLedger,
  type ProjectReportCommissionAggregate,
  type ProjectFinanceLedgerSnapshot,
  type ProjectReportCollectionAggregate,
  type ProjectReportContributionAggregate,
  type ProjectReportMoneyAggregate,
  type ProjectReportReceivableAggregate,
} from "@/features/finance/project-reporting-repository";
import {
  projectFinanceReportFilterSchema,
  type ProjectFinanceReportFilter,
} from "@/features/finance/project-reporting-validation";
import { withUtcConsistentRead } from "@/platform/jobs/mysql-transaction";

export type ProjectFinanceTotals = Readonly<{
  accruedNetAmount: string;
  accruedTotalAmount: string;
  accruedVatAmount: string;
  collectedAmount: string;
  commissionCount: number;
  contributionCount: number;
  expenseNetAmount: string;
  expenseTotalAmount: string;
  expenseVatAmount: string;
  outstandingAmount: string;
  overdueAmount: string;
  partnerContributionExpectedAmount: string;
  partnerContributionReceivedAmount: string;
  partnershipEarnedAmount: string;
  partnershipPaidAmount: string;
  preTaxOperatingDifference: string;
  receivableCount: number;
  collectionCount: number;
  expenseCount: number;
}>;

export type ProjectFinanceReportLine = ProjectFinanceTotals &
  Readonly<{
    activeCustomerCount: number;
    displayName: string;
    id: string;
    projectType: "consulting" | "product" | "partnership" | "internal";
    shortCode: string;
    status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
  }>;

export type ProjectFinanceReport = Readonly<{
  generatedOn: string;
  month: string;
  portfolio: ProjectFinanceTotals;
  projects: readonly ProjectFinanceReportLine[];
  unassigned: ProjectFinanceTotals;
}>;

const ZERO = "0.0000";

function emptyTotals(): ProjectFinanceTotals {
  return {
    accruedNetAmount: ZERO,
    accruedTotalAmount: ZERO,
    accruedVatAmount: ZERO,
    collectedAmount: ZERO,
    collectionCount: 0,
    commissionCount: 0,
    contributionCount: 0,
    expenseCount: 0,
    expenseNetAmount: ZERO,
    expenseTotalAmount: ZERO,
    expenseVatAmount: ZERO,
    outstandingAmount: ZERO,
    overdueAmount: ZERO,
    partnerContributionExpectedAmount: ZERO,
    partnerContributionReceivedAmount: ZERO,
    partnershipEarnedAmount: ZERO,
    partnershipPaidAmount: ZERO,
    preTaxOperatingDifference: ZERO,
    receivableCount: 0,
  };
}

function byProject<T extends { projectId: string | null }>(
  rows: readonly T[],
): Map<string | null, T> {
  return new Map(rows.map((row) => [row.projectId, row]));
}

function totalsFor(
  receivable: ProjectReportReceivableAggregate | undefined,
  collection: ProjectReportCollectionAggregate | undefined,
  expense: ProjectReportMoneyAggregate | undefined,
  commission: ProjectReportCommissionAggregate | undefined,
  contribution: ProjectReportContributionAggregate | undefined,
): ProjectFinanceTotals {
  const accruedNetAmount = receivable?.netAmount ?? ZERO;
  const expenseNetAmount = expense?.netAmount ?? ZERO;
  const partnershipEarnedAmount = commission?.earnedAmount ?? ZERO;
  const partnerContributionExpectedAmount = contribution?.expectedAmount ?? ZERO;
  const outstandingAmount = new Decimal(receivable?.outstandingAmount ?? ZERO)
    .plus(commission?.outstandingAmount ?? ZERO)
    .plus(contribution?.outstandingAmount ?? ZERO)
    .toFixed(4);
  const overdueAmount = new Decimal(receivable?.overdueAmount ?? ZERO)
    .plus(contribution?.overdueAmount ?? ZERO)
    .toFixed(4);
  return {
    accruedNetAmount,
    accruedTotalAmount: receivable?.totalAmount ?? ZERO,
    accruedVatAmount: receivable?.vatAmount ?? ZERO,
    collectedAmount: collection?.collectedAmount ?? ZERO,
    collectionCount: collection?.entryCount ?? 0,
    commissionCount: commission?.entryCount ?? 0,
    contributionCount: contribution?.entryCount ?? 0,
    expenseCount: expense?.entryCount ?? 0,
    expenseNetAmount,
    expenseTotalAmount: expense?.totalAmount ?? ZERO,
    expenseVatAmount: expense?.vatAmount ?? ZERO,
    outstandingAmount,
    overdueAmount,
    partnerContributionExpectedAmount,
    partnerContributionReceivedAmount: contribution?.receivedAmount ?? ZERO,
    partnershipEarnedAmount,
    partnershipPaidAmount: commission?.paidAmount ?? ZERO,
    preTaxOperatingDifference: new Decimal(accruedNetAmount)
      .plus(partnershipEarnedAmount)
      .plus(partnerContributionExpectedAmount)
      .minus(expenseNetAmount)
      .toFixed(4),
    receivableCount: receivable?.entryCount ?? 0,
  };
}

function addTotals(
  left: ProjectFinanceTotals,
  right: ProjectFinanceTotals,
): ProjectFinanceTotals {
  const amount = (key: keyof ProjectFinanceTotals) =>
    new Decimal(String(left[key])).plus(String(right[key])).toFixed(4);
  return {
    accruedNetAmount: amount("accruedNetAmount"),
    accruedTotalAmount: amount("accruedTotalAmount"),
    accruedVatAmount: amount("accruedVatAmount"),
    collectedAmount: amount("collectedAmount"),
    collectionCount: left.collectionCount + right.collectionCount,
    commissionCount: left.commissionCount + right.commissionCount,
    contributionCount: left.contributionCount + right.contributionCount,
    expenseCount: left.expenseCount + right.expenseCount,
    expenseNetAmount: amount("expenseNetAmount"),
    expenseTotalAmount: amount("expenseTotalAmount"),
    expenseVatAmount: amount("expenseVatAmount"),
    outstandingAmount: amount("outstandingAmount"),
    overdueAmount: amount("overdueAmount"),
    partnerContributionExpectedAmount: amount("partnerContributionExpectedAmount"),
    partnerContributionReceivedAmount: amount("partnerContributionReceivedAmount"),
    partnershipEarnedAmount: amount("partnershipEarnedAmount"),
    partnershipPaidAmount: amount("partnershipPaidAmount"),
    preTaxOperatingDifference: amount("preTaxOperatingDifference"),
    receivableCount: left.receivableCount + right.receivableCount,
  };
}

export function composeProjectFinanceReport(
  snapshot: ProjectFinanceLedgerSnapshot,
  month: string,
  generatedOn: string,
): ProjectFinanceReport {
  const receivables = byProject(snapshot.receivables);
  const collections = byProject(snapshot.collections);
  const expenses = byProject(snapshot.expenses);
  const commissions = byProject(snapshot.commissions);
  const contributions = byProject(snapshot.contributions);
  const projects = snapshot.projects.map((project) => ({
    ...project,
    ...totalsFor(
      receivables.get(project.id),
      collections.get(project.id),
      expenses.get(project.id),
      commissions.get(project.id),
      contributions.get(project.id),
    ),
  }));
  const unassigned = totalsFor(
    receivables.get(null),
    collections.get(null),
    expenses.get(null),
    undefined,
    undefined,
  );
  const portfolio = projects.reduce<ProjectFinanceTotals>(
    addTotals,
    addTotals(emptyTotals(), unassigned),
  );
  return { generatedOn, month, portfolio, projects, unassigned };
}

export async function getProjectFinanceReport(
  pool: Pool,
  rawFilter: ProjectFinanceReportFilter,
  now = new Date(),
): Promise<ProjectFinanceReport> {
  const { month } = projectFinanceReportFilterSchema.parse(rawFilter);
  const generatedOn = istanbulDate(now);
  const range = monthBounds(month);
  return withUtcConsistentRead(pool, async (connection) =>
    composeProjectFinanceReport(
      await readProjectFinanceLedger(connection, range, generatedOn),
      month,
      generatedOn,
    ),
  );
}
