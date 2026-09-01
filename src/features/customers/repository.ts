import "server-only";

import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type CustomerStatus = "active" | "inactive";

export type Customer = Readonly<{
  contactNote: string | null;
  createdAtUtc: string;
  displayName: string;
  email: string | null;
  id: string;
  phone: string | null;
  shortCode: string;
  status: CustomerStatus;
  updatedAtUtc: string;
}>;

type CustomerRow = RowDataPacket & {
  contact_note: string | null;
  created_at_utc: string | Date;
  display_name: string;
  email: string | null;
  id: string;
  phone: string | null;
  short_code: string;
  status: string;
  updated_at_utc: string | Date;
};

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

function mapCustomer(row: CustomerRow): Customer {
  if (row.status !== "active" && row.status !== "inactive") {
    throw new Error("Customer status is invalid.");
  }

  return {
    contactNote: row.contact_note,
    createdAtUtc: canonicalDateTime(row.created_at_utc),
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    phone: row.phone,
    shortCode: row.short_code,
    status: row.status,
    updatedAtUtc: canonicalDateTime(row.updated_at_utc),
  };
}

const CUSTOMER_COLUMNS = `
  id, display_name, short_code, status, contact_note, email, phone,
  created_at_utc, updated_at_utc`;

export async function listCustomerRecords(
  connection: PoolConnection,
): Promise<readonly Customer[]> {
  const [rows] = await connection.execute<CustomerRow[]>(
    `SELECT ${CUSTOMER_COLUMNS}
       FROM customer
      ORDER BY status = 'active' DESC, display_name ASC, id ASC`,
  );
  return rows.map(mapCustomer);
}

export async function findCustomerForUpdate(
  connection: PoolConnection,
  id: string,
): Promise<Customer | null> {
  const [rows] = await connection.execute<CustomerRow[]>(
    `SELECT ${CUSTOMER_COLUMNS}
       FROM customer
      WHERE id = ?
      FOR UPDATE`,
    [id],
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
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
