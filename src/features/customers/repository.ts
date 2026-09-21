import { type ProjectScope, projectScopeSql } from "@/platform/auth/project-access";
import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { ProjectStatus } from "@/features/projects/repository";
import {
  mapArchiveMetadata,
  type ArchiveMetadata,
} from "@/features/lifecycle";

export type CustomerStatus = "active" | "inactive";
export type CustomerProjectLinkStatus = "active" | "inactive";

export type CustomerProjectSummary = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: ProjectStatus;
}>;

export type CustomerBillingSummary = Readonly<{
  activeContractCount: number;
  currency: "TRY";
  monthlyFeeAmount: string;
  paymentDays: readonly number[];
  vatMode: "exempt" | "exclusive" | "inclusive" | "mixed";
}>;

export type CustomerOverview = Readonly<{
  billing?: CustomerBillingSummary;
  nextVisitOn: string | null;
}>;

export type Customer = ArchiveMetadata & Readonly<{
  contactNote: string | null;
  createdAtUtc: string;
  displayName: string;
  email: string | null;
  id: string;
  overview: CustomerOverview;
  phone: string | null;
  projects: readonly CustomerProjectSummary[];
  shortCode: string;
  status: CustomerStatus;
  updatedAtUtc: string;
}>;

export type CustomerProjectLink = Readonly<{
  createdAtUtc: string;
  customerId: string;
  projectId: string;
  status: CustomerProjectLinkStatus;
  updatedAtUtc: string;
  version: number;
}>;

type CustomerRow = RowDataPacket & {
  archive_reason: string | null;
  archived_at_utc: string | Date | null;
  archived_by_user_account_id: string | null;
  contact_note: string | null;
  created_at_utc: string | Date;
  customer_status: string;
  display_name: string;
  email: string | null;
  id: string;
  phone: string | null;
  short_code: string;
  updated_at_utc: string | Date;
  version: number;
};

type CustomerProjectRow = RowDataPacket & {
  project_display_name: string | null;
  project_id: string | null;
  project_short_code: string | null;
  project_status: string | null;
};

type CustomerOverviewRow = RowDataPacket & {
  active_contract_count: number | string | null;
  billing_currency: string | null;
  billing_vat_mode: string | null;
  monthly_fee_amount: string | null;
  next_visit_on: string | Date | null;
  payment_days: string | null;
};

type CustomerWithProjectRow = CustomerRow &
  CustomerProjectRow &
  CustomerOverviewRow;

type CustomerProjectLinkRow = RowDataPacket & {
  created_at_utc: string | Date;
  customer_id: string;
  project_id: string;
  status: string;
  updated_at_utc: string | Date;
  version: number;
};

type CustomerProjectUsageRow = RowDataPacket & {
  in_use: number | string;
};

type CustomerLifecycleDependencyRow = RowDataPacket & {
  has_dependencies: number | string;
};

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function customerStatus(value: string): CustomerStatus {
  if (value !== "active" && value !== "inactive") {
    throw new Error("Customer status is invalid.");
  }
  return value;
}

function projectStatus(value: string): ProjectStatus {
  if (
    value !== "planned" &&
    value !== "active" &&
    value !== "on_hold" &&
    value !== "completed" &&
    value !== "cancelled"
  ) {
    throw new Error("Customer project status is invalid.");
  }
  return value;
}

function linkStatus(value: string): CustomerProjectLinkStatus {
  if (value !== "active" && value !== "inactive") {
    throw new Error("Customer project link status is invalid.");
  }
  return value;
}

function validVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Customer project link version is invalid.");
  }
  return value;
}

function mapCustomer(
  row: CustomerRow,
  projects: readonly CustomerProjectSummary[],
  overview: CustomerOverview = { nextVisitOn: null },
): Customer {
  return {
    ...mapArchiveMetadata(row),
    contactNote: row.contact_note,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    overview,
    phone: row.phone,
    projects,
    shortCode: row.short_code,
    status: customerStatus(row.customer_status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
  };
}

function mapBillingSummary(
  row: CustomerOverviewRow,
): CustomerBillingSummary | undefined {
  if (
    row.active_contract_count === null &&
    row.billing_currency === null &&
    row.billing_vat_mode === null &&
    row.monthly_fee_amount === null &&
    row.payment_days === null
  ) {
    return undefined;
  }
  if (
    row.active_contract_count === null ||
    row.billing_currency !== "TRY" ||
    row.billing_vat_mode === null ||
    row.monthly_fee_amount === null ||
    row.payment_days === null
  ) {
    throw new Error("Customer billing projection is invalid.");
  }
  const activeContractCount = Number(row.active_contract_count);
  const paymentDays = row.payment_days.split(",").map(Number);
  if (
    !Number.isSafeInteger(activeContractCount) ||
    activeContractCount < 1 ||
    paymentDays.length === 0 ||
    paymentDays.some(
      (day) => !Number.isSafeInteger(day) || day < 1 || day > 31,
    ) ||
    !["exempt", "exclusive", "inclusive", "mixed"].includes(
      row.billing_vat_mode,
    )
  ) {
    throw new Error("Customer billing projection is invalid.");
  }
  return {
    activeContractCount,
    currency: "TRY",
    monthlyFeeAmount: row.monthly_fee_amount,
    paymentDays,
    vatMode: row.billing_vat_mode as CustomerBillingSummary["vatMode"],
  };
}

function mapOverview(row: CustomerOverviewRow): CustomerOverview {
  const billing = mapBillingSummary(row);
  return {
    ...(billing ? { billing } : {}),
    nextVisitOn:
      row.next_visit_on === null ? null : canonicalDate(row.next_visit_on),
  };
}

function mapProjectSummary(
  row: CustomerProjectRow,
): CustomerProjectSummary | null {
  const values = [
    row.project_id,
    row.project_display_name,
    row.project_short_code,
    row.project_status,
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Customer project projection is invalid.");
  }
  return {
    displayName: row.project_display_name as string,
    id: row.project_id as string,
    shortCode: row.project_short_code as string,
    status: projectStatus(row.project_status as string),
  };
}

function mapCustomerProjectLink(row: CustomerProjectLinkRow): CustomerProjectLink {
  return {
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    customerId: row.customer_id,
    projectId: row.project_id,
    status: linkStatus(row.status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
    version: validVersion(row.version),
  };
}

function canonicalDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function requireBusinessDate(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Customer projection business date is invalid.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Customer projection business date is invalid.");
  }
  return value;
}

const CUSTOMER_IDENTITY_COLUMNS = `
  c.id, c.display_name, c.short_code, c.status AS customer_status,
  c.archive_reason, c.archived_at_utc, c.archived_by_user_account_id,
  c.version, c.created_at_utc, c.updated_at_utc`;

const CUSTOMER_CONTACT_COLUMNS =
  "c.contact_note, c.email, c.phone";

const REDACTED_CUSTOMER_CONTACT_COLUMNS =
  "NULL AS contact_note, NULL AS email, NULL AS phone";

const CUSTOMER_PROJECT_COLUMNS = `
  p.id AS project_id, p.display_name AS project_display_name,
  p.short_code AS project_short_code, p.status AS project_status`;

export async function listCustomerRecords(
  connection: PoolConnection,
  options: Readonly<{
    projectIds?: ProjectScope;
    businessDate?: string;
    includeBilling?: boolean;
    includeContact?: boolean;
    includeVisits?: boolean;
  }> = {},
): Promise<readonly Customer[]> {
  const businessDate =
    options.includeBilling || options.includeVisits
      ? requireBusinessDate(options.businessDate)
      : null;
  const contactColumns = options.includeContact
    ? CUSTOMER_CONTACT_COLUMNS
    : REDACTED_CUSTOMER_CONTACT_COLUMNS;
  const billingColumns = options.includeBilling
    ? `billing.active_contract_count, billing.currency AS billing_currency,
       billing.monthly_fee_amount, billing.payment_days,
       billing.vat_mode AS billing_vat_mode`
    : `NULL AS active_contract_count, NULL AS billing_currency,
       NULL AS monthly_fee_amount, NULL AS payment_days,
       NULL AS billing_vat_mode`;
  const billingJoin = options.includeBilling
    ? `LEFT JOIN (
         SELECT customer_id, COUNT(*) AS active_contract_count,
                MIN(currency) AS currency,
                CAST(SUM(monthly_fee_amount) AS DECIMAL(19, 4)) AS monthly_fee_amount,
                GROUP_CONCAT(DISTINCT payment_day ORDER BY payment_day SEPARATOR ',') AS payment_days,
                CASE WHEN COUNT(DISTINCT vat_mode) = 1
                     THEN MIN(vat_mode) ELSE 'mixed' END AS vat_mode
          FROM consulting_contract
          WHERE status = 'active'
            AND starts_on <= ?
            AND ends_on >= ?
          GROUP BY customer_id
       ) billing ON billing.customer_id = c.id`
    : "";
  const visitColumns = options.includeVisits
    ? "upcoming.next_visit_on"
    : "NULL AS next_visit_on";
  const visitJoin = options.includeVisits
    ? `LEFT JOIN (
         SELECT contract.customer_id, MIN(visit.committed_on) AS next_visit_on
           FROM monthly_visit_commitment visit
           JOIN consulting_contract contract ON contract.id = visit.contract_id
          WHERE contract.status = 'active'
            AND visit.resolution_status IN ('planned', 'makeup_pending')
            AND visit.committed_on >= ?
          GROUP BY contract.customer_id
       ) upcoming ON upcoming.customer_id = c.id`
    : "";
  const scope = projectScopeSql("cp.project_id", options.projectIds ?? null);
  const query = `SELECT ${CUSTOMER_IDENTITY_COLUMNS}, ${contactColumns},
            ${CUSTOMER_PROJECT_COLUMNS}, ${visitColumns}, ${billingColumns}
       FROM customer c
       LEFT JOIN customer_project cp
         ON cp.customer_id = c.id AND cp.status = 'active'
       LEFT JOIN project p ON p.id = cp.project_id
       ${visitJoin}
       ${billingJoin}
      WHERE ${scope.sql}
      ORDER BY c.status = 'active' DESC, c.display_name ASC, c.id ASC,
               p.display_name ASC, p.id ASC`;
  const parameters = [
    ...(options.includeVisits ? [businessDate as string] : []),
    ...(options.includeBilling
      ? [businessDate as string, businessDate as string]
      : []),
    ...scope.values,
  ];
  const [rows] = parameters.length > 0
    ? await connection.execute<CustomerWithProjectRow[]>(query, parameters)
    : await connection.execute<CustomerWithProjectRow[]>(query);

  const result: Array<{
    customer: Customer;
    projects: CustomerProjectSummary[];
  }> = [];
  const byId = new Map<string, (typeof result)[number]>();
  for (const row of rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      const projects: CustomerProjectSummary[] = [];
      entry = { customer: mapCustomer(row, projects, mapOverview(row)), projects };
      byId.set(row.id, entry);
      result.push(entry);
    }
    const project = mapProjectSummary(row);
    if (project) entry.projects.push(project);
  }
  return result.map(({ customer }) => customer);
}

export async function listActiveCustomerProjectRecords(
  connection: PoolConnection,
  customerId: string,
): Promise<readonly CustomerProjectSummary[]> {
  const [rows] = await connection.execute<CustomerProjectRow[]>(
    `SELECT ${CUSTOMER_PROJECT_COLUMNS}
       FROM customer_project cp
       JOIN project p ON p.id = cp.project_id
      WHERE cp.customer_id = ? AND cp.status = 'active'
      ORDER BY p.display_name ASC, p.id ASC`,
    [customerId],
  );
  return rows.map((row) => {
    const project = mapProjectSummary(row);
    if (!project) throw new Error("Customer project projection is missing.");
    return project;
  });
}

export async function findCustomerForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<Customer | null> {
  const [rows] = await connection.execute<CustomerRow[]>(
    `SELECT ${CUSTOMER_IDENTITY_COLUMNS}, ${CUSTOMER_CONTACT_COLUMNS}
       FROM customer c
      WHERE c.id = ?
      FOR UPDATE`,
    [id],
  );
  if (!rows[0]) return null;
  const projects = await listActiveCustomerProjectRecords(connection, id);
  return mapCustomer(rows[0], projects);
}

export async function listCustomerProjectLinksForUpdate(
  connection: PoolConnection,
  customerId: string,
): Promise<readonly CustomerProjectLink[]> {
  const [rows] = await connection.execute<CustomerProjectLinkRow[]>(
    `SELECT customer_id, project_id, status, version,
            created_at_utc, updated_at_utc
       FROM customer_project
      WHERE customer_id = ?
      ORDER BY project_id ASC
      FOR UPDATE`,
    [customerId],
  );
  return rows.map(mapCustomerProjectLink);
}

export async function findActiveCustomerProjectForUpdate(
  connection: PoolConnection,
  customerId: string,
  projectId: string,
): Promise<CustomerProjectLink | null> {
  const [rows] = await connection.execute<CustomerProjectLinkRow[]>(
    `SELECT cp.customer_id, cp.project_id, cp.status, cp.version,
            cp.created_at_utc, cp.updated_at_utc
       FROM customer_project cp
       JOIN project p ON p.id = cp.project_id
      WHERE cp.customer_id = ? AND cp.project_id = ? AND cp.status = 'active'
        AND p.archived_at_utc IS NULL
        AND p.status IN ('planned', 'active', 'on_hold')
      FOR UPDATE`,
    [customerId, projectId],
  );
  return rows[0] ? mapCustomerProjectLink(rows[0]) : null;
}

export async function customerProjectLinkIsInUse(
  connection: PoolConnection,
  customerId: string,
  projectId: string,
): Promise<boolean> {
  const [rows] = await connection.execute<CustomerProjectUsageRow[]>(
    `SELECT (
       EXISTS(
         SELECT 1
           FROM consulting_contract AS contract
          WHERE contract.customer_id = ?
            AND contract.project_id = ?
            AND contract.status IN ('draft', 'active')
       ) OR EXISTS(
         SELECT 1
           FROM work_task AS task
           JOIN work_task_project AS task_project
             ON task_project.task_id = task.id
          WHERE task.customer_id = ?
            AND task_project.project_id = ?
            AND task.status NOT IN ('done', 'cancelled')
       )
     ) AS in_use`,
    [customerId, projectId, customerId, projectId],
  );
  const value = Number(rows[0]?.in_use ?? 0);
  if (value !== 0 && value !== 1) {
    throw new Error("Customer project usage query returned an invalid value.");
  }
  return value === 1;
}

export async function customerHasLifecycleDependencies(
  connection: PoolConnection,
  customerId: string,
): Promise<boolean> {
  const [rows] = await connection.execute<CustomerLifecycleDependencyRow[]>(
    `SELECT (
       EXISTS(
         SELECT 1
           FROM consulting_contract
          WHERE customer_id = ?
            AND status IN ('draft', 'active')
       ) OR EXISTS(
         SELECT 1
           FROM work_task
          WHERE customer_id = ?
            AND status NOT IN ('done', 'cancelled')
       ) OR EXISTS(
         SELECT 1
           FROM receivable r
           LEFT JOIN (
             SELECT receivable_id,
                    SUM(CASE
                          WHEN entry_type = 'reversal' THEN -amount
                          ELSE amount
                        END) AS collected_amount
               FROM receivable_collection
              GROUP BY receivable_id
           ) rc ON rc.receivable_id = r.id
          WHERE r.customer_id = ?
            AND r.record_state = 'active'
            AND r.total_amount > COALESCE(rc.collected_amount, 0.0000)
       )
     ) AS has_dependencies`,
    [customerId, customerId, customerId],
  );
  const value = Number(rows[0]?.has_dependencies ?? -1);
  if (value !== 0 && value !== 1) {
    throw new Error("Customer lifecycle dependency query is invalid.");
  }
  return value === 1;
}

export async function insertCustomerRecord(
  connection: PoolConnection,
  customer: Customer,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO customer
       (id, display_name, short_code, status, contact_note, email, phone,
        archive_reason, archived_at_utc, archived_by_user_account_id, version,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customer.id,
      customer.displayName,
      customer.shortCode,
      customer.status,
      customer.contactNote,
      customer.email,
      customer.phone,
      customer.archiveReason,
      customer.archivedAtUtc,
      customer.archivedByUserAccountId,
      customer.version,
      customer.createdAtUtc,
      customer.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Customer insert failed.");
}

export async function updateCustomerRecord(
  connection: PoolConnection,
  customer: Customer,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE customer
        SET display_name = ?, short_code = ?, status = ?, contact_note = ?,
            email = ?, phone = ?, archive_reason = ?, archived_at_utc = ?,
            archived_by_user_account_id = ?, version = ?, updated_at_utc = ?
      WHERE id = ? AND version = ?`,
    [
      customer.displayName,
      customer.shortCode,
      customer.status,
      customer.contactNote,
      customer.email,
      customer.phone,
      customer.archiveReason,
      customer.archivedAtUtc,
      customer.archivedByUserAccountId,
      customer.version,
      customer.updatedAtUtc,
      customer.id,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}

export async function insertCustomerProjectLink(
  connection: PoolConnection,
  link: CustomerProjectLink,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO customer_project
       (customer_id, project_id, status, version, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      link.customerId,
      link.projectId,
      link.status,
      link.version,
      link.createdAtUtc,
      link.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) {
    throw new Error("Customer project link insert failed.");
  }
}

export async function updateCustomerProjectLinkStatus(
  connection: PoolConnection,
  link: CustomerProjectLink,
  expectedVersion: number,
): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE customer_project
        SET status = ?, version = ?, updated_at_utc = ?
      WHERE customer_id = ? AND project_id = ? AND version = ?`,
    [
      link.status,
      link.version,
      link.updatedAtUtc,
      link.customerId,
      link.projectId,
      expectedVersion,
    ],
  );
  return result.affectedRows === 1;
}
