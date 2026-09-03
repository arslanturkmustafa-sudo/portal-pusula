import "server-only";

import Decimal from "decimal.js";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export type ProjectReportIdentity = Readonly<{
  activeCustomerCount: number;
  displayName: string;
  id: string;
  projectType: "consulting" | "product" | "partnership" | "internal";
  shortCode: string;
  status: "planned" | "active" | "on_hold" | "completed" | "cancelled";
}>;

export type ProjectReportMoneyAggregate = Readonly<{
  entryCount: number;
  netAmount: string;
  projectId: string | null;
  totalAmount: string;
  vatAmount: string;
}>;

export type ProjectReportReceivableAggregate =
  ProjectReportMoneyAggregate &
    Readonly<{
      outstandingAmount: string;
      overdueAmount: string;
    }>;

export type ProjectReportCollectionAggregate = Readonly<{
  collectedAmount: string;
  entryCount: number;
  projectId: string | null;
}>;

export type ProjectReportCommissionAggregate = Readonly<{
  earnedAmount: string;
  entryCount: number;
  outstandingAmount: string;
  paidAmount: string;
  projectId: string;
}>;

export type ProjectReportContributionAggregate = Readonly<{
  entryCount: number;
  expectedAmount: string;
  outstandingAmount: string;
  overdueAmount: string;
  projectId: string;
  receivedAmount: string;
}>;

export type ProjectFinanceLedgerSnapshot = Readonly<{
  collections: readonly ProjectReportCollectionAggregate[];
  commissions: readonly ProjectReportCommissionAggregate[];
  contributions: readonly ProjectReportContributionAggregate[];
  expenses: readonly ProjectReportMoneyAggregate[];
  projects: readonly ProjectReportIdentity[];
  receivables: readonly ProjectReportReceivableAggregate[];
}>;

type ProjectRow = RowDataPacket & {
  active_customer_count: number | string;
  display_name: string;
  id: string;
  project_type: string;
  short_code: string;
  status: string;
};

type MoneyAggregateRow = RowDataPacket & {
  entry_count: number | string;
  net_amount: string;
  project_id: string | null;
  total_amount: string;
  vat_amount: string;
};

type ReceivableAggregateRow = MoneyAggregateRow & {
  outstanding_amount: string;
  overdue_amount: string;
};

type CollectionAggregateRow = RowDataPacket & {
  collected_amount: string;
  entry_count: number | string;
  project_id: string | null;
};

type CommissionAggregateRow = RowDataPacket & {
  earned_amount: string;
  entry_count: number | string;
  outstanding_amount: string;
  paid_amount: string;
  project_id: string;
};

type ContributionAggregateRow = RowDataPacket & {
  entry_count: number | string;
  expected_amount: string;
  outstanding_amount: string;
  overdue_amount: string;
  project_id: string;
  received_amount: string;
};

function money(value: string): string {
  return new Decimal(value).toFixed(4);
}

function count(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Project report count is invalid.");
  }
  return parsed;
}

function projectType(value: string): ProjectReportIdentity["projectType"] {
  if (
    value !== "consulting" &&
    value !== "product" &&
    value !== "partnership" &&
    value !== "internal"
  ) {
    throw new Error("Project report type is invalid.");
  }
  return value;
}

function projectStatus(value: string): ProjectReportIdentity["status"] {
  if (
    value !== "planned" &&
    value !== "active" &&
    value !== "on_hold" &&
    value !== "completed" &&
    value !== "cancelled"
  ) {
    throw new Error("Project report status is invalid.");
  }
  return value;
}

function mapMoneyAggregate(row: MoneyAggregateRow): ProjectReportMoneyAggregate {
  return {
    entryCount: count(row.entry_count),
    netAmount: money(row.net_amount),
    projectId: row.project_id,
    totalAmount: money(row.total_amount),
    vatAmount: money(row.vat_amount),
  };
}

export async function readProjectFinanceLedger(
  connection: PoolConnection,
  range: Readonly<{ monthStart: string; nextMonthStart: string }>,
  today: string,
): Promise<ProjectFinanceLedgerSnapshot> {
  const [projectRows] = await connection.execute<ProjectRow[]>(
    `SELECT p.id, p.display_name, p.short_code, p.project_type, p.status,
            COUNT(CASE WHEN cp.status = 'active' AND c.id IS NOT NULL THEN 1 END) AS active_customer_count
       FROM project p
       LEFT JOIN customer_project cp ON cp.project_id = p.id
       LEFT JOIN customer c ON c.id = cp.customer_id AND c.status = 'active'
      GROUP BY p.id, p.display_name, p.short_code, p.project_type, p.status
      ORDER BY FIELD(p.status, 'active', 'planned', 'on_hold', 'completed', 'cancelled'),
               p.display_name ASC, p.id ASC`,
  );

  const [receivableRows] = await connection.execute<ReceivableAggregateRow[]>(
    `SELECT r.project_id,
            COUNT(*) AS entry_count,
            COALESCE(SUM(r.net_amount), 0.0000) AS net_amount,
            COALESCE(SUM(r.vat_amount), 0.0000) AS vat_amount,
            COALESCE(SUM(r.total_amount), 0.0000) AS total_amount,
            COALESCE(SUM(GREATEST(r.total_amount - COALESCE(rc.collected_amount, 0.0000), 0.0000)), 0.0000) AS outstanding_amount,
            COALESCE(SUM(CASE
              WHEN r.due_on < ? THEN GREATEST(r.total_amount - COALESCE(rc.collected_amount, 0.0000), 0.0000)
              ELSE 0.0000
            END), 0.0000) AS overdue_amount
       FROM receivable r
       LEFT JOIN (
         SELECT receivable_id, SUM(amount) AS collected_amount
           FROM receivable_collection
          GROUP BY receivable_id
       ) rc ON rc.receivable_id = r.id
      WHERE (r.period_month >= ? AND r.period_month < ?)
         OR (r.period_month IS NULL AND r.due_on >= ? AND r.due_on < ?)
      GROUP BY r.project_id`,
    [
      today,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
    ],
  );

  const [collectionRows] = await connection.execute<CollectionAggregateRow[]>(
    `SELECT r.project_id,
            COUNT(*) AS entry_count,
            COALESCE(SUM(rc.amount), 0.0000) AS collected_amount
       FROM receivable_collection rc
       JOIN receivable r ON r.id = rc.receivable_id
      WHERE rc.collected_on >= ? AND rc.collected_on < ?
      GROUP BY r.project_id`,
    [range.monthStart, range.nextMonthStart],
  );

  const [expenseRows] = await connection.execute<MoneyAggregateRow[]>(
    `SELECT e.project_id,
            COUNT(*) AS entry_count,
            COALESCE(SUM(e.net_amount), 0.0000) AS net_amount,
            COALESCE(SUM(e.vat_amount), 0.0000) AS vat_amount,
            COALESCE(SUM(e.total_amount), 0.0000) AS total_amount
       FROM expense e
      WHERE e.status = 'active'
        AND e.incurred_on >= ? AND e.incurred_on < ?
      GROUP BY e.project_id`,
    [range.monthStart, range.nextMonthStart],
  );

  const [commissionRows] = await connection.execute<CommissionAggregateRow[]>(
    `SELECT pc.project_id,
            COUNT(CASE
              WHEN pc.status IN ('agency_collected', 'paid')
               AND pc.agency_collected_on >= ? AND pc.agency_collected_on < ? THEN 1
            END) AS entry_count,
            COALESCE(SUM(CASE
              WHEN pc.status IN ('agency_collected', 'paid')
               AND pc.agency_collected_on >= ? AND pc.agency_collected_on < ?
              THEN pc.share_amount ELSE 0.0000
            END), 0.0000) AS earned_amount,
            COALESCE(SUM(CASE
              WHEN pc.status = 'paid'
               AND pc.paid_on >= ? AND pc.paid_on < ?
              THEN pc.share_amount ELSE 0.0000
            END), 0.0000) AS paid_amount
            ,COALESCE(SUM(CASE
              WHEN pc.status = 'agency_collected'
               AND pc.agency_collected_on >= ? AND pc.agency_collected_on < ?
              THEN pc.share_amount ELSE 0.0000
            END), 0.0000) AS outstanding_amount
       FROM partnership_commission pc
      WHERE (pc.status IN ('agency_collected', 'paid')
             AND pc.agency_collected_on >= ? AND pc.agency_collected_on < ?)
         OR (pc.status = 'paid' AND pc.paid_on >= ? AND pc.paid_on < ?)
      GROUP BY pc.project_id`,
    [
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
    ],
  );

  const [contributionRows] = await connection.execute<ContributionAggregateRow[]>(
    `SELECT pc.project_id,
            COUNT(CASE
              WHEN pc.status <> 'cancelled'
               AND pc.contribution_month >= ? AND pc.contribution_month < ? THEN 1
            END) AS entry_count,
            COALESCE(SUM(CASE
              WHEN pc.status <> 'cancelled'
               AND pc.contribution_month >= ? AND pc.contribution_month < ?
              THEN pc.expected_amount ELSE 0.0000
            END), 0.0000) AS expected_amount,
            COALESCE(SUM(CASE
              WHEN pc.status <> 'cancelled'
               AND pc.contribution_month >= ? AND pc.contribution_month < ?
              THEN pc.expected_amount - pc.received_amount ELSE 0.0000
            END), 0.0000) AS outstanding_amount,
            COALESCE(SUM(CASE
              WHEN pc.status <> 'cancelled'
               AND pc.contribution_month >= ? AND pc.contribution_month < ?
               AND pc.due_on < ?
              THEN pc.expected_amount - pc.received_amount ELSE 0.0000
            END), 0.0000) AS overdue_amount,
            COALESCE(SUM(COALESCE(receipt.received_amount, 0.0000)), 0.0000) AS received_amount
       FROM partnership_contribution pc
       LEFT JOIN (
         SELECT contribution_id, SUM(amount) AS received_amount
           FROM partnership_contribution_receipt
          WHERE received_on >= ? AND received_on < ?
          GROUP BY contribution_id
       ) receipt ON receipt.contribution_id = pc.id
      WHERE (pc.status <> 'cancelled'
             AND pc.contribution_month >= ? AND pc.contribution_month < ?)
         OR receipt.received_amount IS NOT NULL
      GROUP BY pc.project_id`,
    [
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
      today,
      range.monthStart,
      range.nextMonthStart,
      range.monthStart,
      range.nextMonthStart,
    ],
  );

  return {
    collections: collectionRows.map((row) => ({
      collectedAmount: money(row.collected_amount),
      entryCount: count(row.entry_count),
      projectId: row.project_id,
    })),
    commissions: commissionRows.map((row) => ({
      earnedAmount: money(row.earned_amount),
      entryCount: count(row.entry_count),
      outstandingAmount: money(row.outstanding_amount),
      paidAmount: money(row.paid_amount),
      projectId: row.project_id,
    })),
    contributions: contributionRows.map((row) => ({
      entryCount: count(row.entry_count),
      expectedAmount: money(row.expected_amount),
      outstandingAmount: money(row.outstanding_amount),
      overdueAmount: money(row.overdue_amount),
      projectId: row.project_id,
      receivedAmount: money(row.received_amount),
    })),
    expenses: expenseRows.map(mapMoneyAggregate),
    projects: projectRows.map((row) => ({
      activeCustomerCount: count(row.active_customer_count),
      displayName: row.display_name,
      id: row.id,
      projectType: projectType(row.project_type),
      shortCode: row.short_code,
      status: projectStatus(row.status),
    })),
    receivables: receivableRows.map((row) => ({
      ...mapMoneyAggregate(row),
      outstandingAmount: money(row.outstanding_amount),
      overdueAmount: money(row.overdue_amount),
    })),
  };
}
