import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { ProjectStatus } from "@/features/projects/repository";

export type CustomerStatus = "active" | "inactive";
export type CustomerProjectLinkStatus = "active" | "inactive";

export type CustomerProjectSummary = Readonly<{
  displayName: string;
  id: string;
  shortCode: string;
  status: ProjectStatus;
}>;

export type Customer = Readonly<{
  contactNote: string | null;
  createdAtUtc: string;
  displayName: string;
  email: string | null;
  id: string;
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
  contact_note: string | null;
  created_at_utc: string | Date;
  customer_status: string;
  display_name: string;
  email: string | null;
  id: string;
  phone: string | null;
  short_code: string;
  updated_at_utc: string | Date;
};

type CustomerProjectRow = RowDataPacket & {
  project_display_name: string | null;
  project_id: string | null;
  project_short_code: string | null;
  project_status: string | null;
};

type CustomerWithProjectRow = CustomerRow & CustomerProjectRow;

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
): Customer {
  return {
    contactNote: row.contact_note,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    phone: row.phone,
    projects,
    shortCode: row.short_code,
    status: customerStatus(row.customer_status),
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
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

const CUSTOMER_COLUMNS = `
  c.id, c.display_name, c.short_code, c.status AS customer_status,
  c.contact_note, c.email, c.phone, c.created_at_utc, c.updated_at_utc`;

const CUSTOMER_PROJECT_COLUMNS = `
  p.id AS project_id, p.display_name AS project_display_name,
  p.short_code AS project_short_code, p.status AS project_status`;

export async function listCustomerRecords(
  connection: PoolConnection,
): Promise<readonly Customer[]> {
  const [rows] = await connection.execute<CustomerWithProjectRow[]>(
    `SELECT ${CUSTOMER_COLUMNS}, ${CUSTOMER_PROJECT_COLUMNS}
       FROM customer c
       LEFT JOIN customer_project cp
         ON cp.customer_id = c.id AND cp.status = 'active'
       LEFT JOIN project p ON p.id = cp.project_id
      ORDER BY c.status = 'active' DESC, c.display_name ASC, c.id ASC,
               p.display_name ASC, p.id ASC`,
  );

  const result: Array<{
    customer: Customer;
    projects: CustomerProjectSummary[];
  }> = [];
  const byId = new Map<string, (typeof result)[number]>();
  for (const row of rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      const projects: CustomerProjectSummary[] = [];
      entry = { customer: mapCustomer(row, projects), projects };
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
    `SELECT ${CUSTOMER_COLUMNS}
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
    `SELECT customer_id, project_id, status, version,
            created_at_utc, updated_at_utc
       FROM customer_project
      WHERE customer_id = ? AND project_id = ? AND status = 'active'
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
            AND task.status <> 'done'
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

export async function insertCustomerRecord(
  connection: PoolConnection,
  customer: Customer,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO customer
       (id, display_name, short_code, status, contact_note, email, phone,
        created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customer.id,
      customer.displayName,
      customer.shortCode,
      customer.status,
      customer.contactNote,
      customer.email,
      customer.phone,
      customer.createdAtUtc,
      customer.updatedAtUtc,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Customer insert failed.");
}

export async function updateCustomerRecord(
  connection: PoolConnection,
  customer: Customer,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE customer
        SET display_name = ?, short_code = ?, status = ?, contact_note = ?,
            email = ?, phone = ?, updated_at_utc = ?
      WHERE id = ?`,
    [
      customer.displayName,
      customer.shortCode,
      customer.status,
      customer.contactNote,
      customer.email,
      customer.phone,
      customer.updatedAtUtc,
      customer.id,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Customer update failed.");
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
