// @vitest-environment node

import { randomUUID } from "node:crypto";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCustomer,
  listCustomers,
  updateCustomer,
} from "../../src/features/customers/service";
import { registerMySqlPoolDatabase } from "../../src/platform/database/mysql-session-contract";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";

type AuditRow = RowDataPacket & {
  action: string;
  after_summary: string | null;
  before_summary: string | null;
  entity_id: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!enabled || !value) {
    throw new Error("Disposable MariaDB customer test environment is incomplete.");
  }
  return value;
}

describe.skipIf(!enabled)("MariaDB customer persistence", () => {
  let pool: Pool;

  beforeAll(() => {
    const database = requiredEnvironment("DB_NAME");
    pool = mysql.createPool({
      charset: "utf8mb4",
      connectionLimit: 2,
      database,
      host: requiredEnvironment("DB_HOST"),
      password: requiredEnvironment("DB_PASSWORD"),
      port: Number(requiredEnvironment("DB_PORT")),
      timezone: "Z",
      user: requiredEnvironment("DB_USER"),
    });
    registerMySqlPoolDatabase(pool, database);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates, reads, updates and audits a Turkish customer record", async () => {
    const correlationId = randomUUID();
    const created = await createCustomer(
      pool,
      {
        contactNote: "Üretim müdürüyle salı günü görüşülecek.",
        displayName: "Öncü Üretim Çözümleri",
        email: "yonetim@oncu.example",
        phone: "+90 532 000 00 00",
        shortCode: "oncu_uretim",
        status: "active",
      },
      { correlationId, now: new Date("2026-09-01T08:15:30.123Z") },
    );

    expect(created.shortCode).toBe("ONCU_URETIM");
    expect(created.displayName).toBe("Öncü Üretim Çözümleri");

    const listedAfterCreate = await listCustomers(pool);
    expect(listedAfterCreate).toContainEqual(created);

    const updated = await updateCustomer(
      pool,
      created.id,
      { displayName: "Öncü Üretim ve Dağıtım", status: "inactive" },
      { correlationId, now: new Date("2026-09-01T09:45:00.456Z") },
    );
    expect(updated.displayName).toBe("Öncü Üretim ve Dağıtım");
    expect(updated.status).toBe("inactive");

    const listedAfterUpdate = await listCustomers(pool);
    expect(listedAfterUpdate).toContainEqual(updated);

    const [auditRows] = await pool.execute<AuditRow[]>(
      `SELECT action, entity_id, before_summary, after_summary
         FROM audit_event
        WHERE correlation_id = ?
        ORDER BY occurred_at_utc ASC, id ASC`,
      [correlationId],
    );

    expect(auditRows).toHaveLength(2);
    expect(auditRows.map((row) => row.action)).toEqual([
      "customer.created",
      "customer.updated",
    ]);
    expect(auditRows.every((row) => row.entity_id === created.id)).toBe(true);

    const serializedAudit = JSON.stringify(auditRows);
    expect(serializedAudit).toContain("Öncü Üretim ve Dağıtım");
    expect(serializedAudit).not.toContain("yonetim@oncu.example");
    expect(serializedAudit).not.toContain("+90 532 000 00 00");
    expect(serializedAudit).not.toContain("Üretim müdürüyle");
  });
});
