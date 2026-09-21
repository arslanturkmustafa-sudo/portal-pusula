import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { receiveTransfer, openTransfer, importTransfer } from "@/features/bypusula/service";
import { stepKey, type Envelope, type Preview } from "@/features/bypusula/contract";
import { updateTask } from "@/features/tasks/service";
import { registerMySqlPoolDatabase } from "@/platform/database/mysql-session-contract";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const actorId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const unlinkedProjectId = "44444444-4444-4444-8444-444444444444";
const context = { actorId, correlationId: "bypusula-disposable-db" };

function disposableEnvironment() {
  const expected = {
    DB_HOST: "127.0.0.1", DB_NAME: "portal_pusula_migration_test",
    DB_USER: "portal_pusula_test", DB_PASSWORD: "portal-pusula-local-test-only",
  };
  const port = Number(process.env.DB_PORT);
  if (!enabled || Object.entries(expected).some(([key, value]) => process.env[key] !== value) ||
      !Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306) {
    throw new Error("This test requires the runner's disposable loopback database.");
  }
  return { ...expected, DB_PORT: String(port) };
}

function migrate(): Promise<void> {
  const environment: NodeJS.ProcessEnv = { ...disposableEnvironment(), NODE_ENV: "test" };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"] as const) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], { env: environment, stdio: "ignore", windowsHide: true });
    child.once("error", () => reject(new Error("Disposable migration could not start.")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Disposable migration failed.")));
  });
}

function envelope(analysisId: string, titlePrefix: string): Envelope {
  const sample = JSON.parse(readFileSync("docs/bypusula-transfer-v1.example.json", "utf8")) as Envelope;
  sample.analysis.id = analysisId;
  sample.analysis.url = `https://bypusula.example/panel/?mk_tab=improvements&analysis_id=${analysisId}`;
  sample.company.externalId = `analysis-subject:${analysisId}`;
  sample.programs[0].steps = [1, 2, 3].map((sequence) => ({
    code: `IMPLEMENTATION_ACTION_0${sequence}`, sequence,
    title: `${titlePrefix} ${sequence}`, description: "Sentetik veritabanı doğrulama adımı.", priority: "normal",
  }));
  return sample;
}

function command(preview: Preview) {
  return { action: "import", id: preview.id, digest: preview.digest, customerId, projectId,
    selected: preview.envelope.programs.flatMap((program) => program.steps.map((step) => stepKey(program, step))) };
}

describe.skipIf(!enabled).sequential("ByPusula transfer on disposable MariaDB", () => {
  let pool: Pool;

  async function count(sql: string, values: string[] = []): Promise<number> {
    const [rows] = await pool.execute<(RowDataPacket & { total: number })[]>(sql, values);
    return Number(rows[0].total);
  }

  beforeAll(async () => {
    const environment = disposableEnvironment();
    await migrate(); // One clean schema setup, not the full migration test suite.
    pool = mysql.createPool({
      host: environment.DB_HOST, port: Number(environment.DB_PORT), database: environment.DB_NAME,
      user: environment.DB_USER, password: environment.DB_PASSWORD,
      charset: "utf8mb4", timezone: "Z", dateStrings: true, connectionLimit: 4,
      multipleStatements: false, connectTimeout: 5000,
    });
    registerMySqlPoolDatabase(pool, environment.DB_NAME);
    // Literal non-login fixture, never a production credential or generated secret.
    await pool.execute(`INSERT INTO user_account
      (id, email, display_name, password_hash, password_changed_at_utc, created_at_utc, updated_at_utc)
      VALUES (?, 'bypusula-test@example.invalid', 'Sentetik Kullanıcı', ?, '2026-01-01', '2026-01-01', '2026-01-01')`,
    [actorId, `scrypt:32768:8:1:${"a".repeat(22)}:${"b".repeat(86)}`]);
    await pool.execute("INSERT INTO customer (id, display_name, short_code) VALUES (?, 'Sentetik Firma', 'BYP_TEST')", [customerId]);
    await pool.execute(`INSERT INTO project (id, display_name, short_code, project_type, status)
      VALUES (?, 'Sentetik Proje', 'BYP_TEST', 'consulting', 'active'), (?, 'İlişkisiz Proje', 'BYP_OTHER', 'consulting', 'active')`, [projectId, unlinkedProjectId]);
    await pool.execute("INSERT INTO customer_project (customer_id, project_id) VALUES (?, ?)", [customerId, projectId]);
  }, 30_000);

  afterAll(async () => { if (pool) await pool.end(); });

  it("applies the real migration and serializes concurrent first delivery without replacing a snapshot", async () => {
    expect(await count("SELECT COUNT(*) AS total FROM __drizzle_migrations")).toBe(28);
    const [columns] = await pool.execute<(RowDataPacket & { COLLATION_NAME: string })[]>(
      `SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('bypusula_analysis', 'bypusula_task_link') AND DATA_TYPE = 'char'`);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.every((column) => column.COLLATION_NAME === "ascii_bin")).toBe(true);
    const source = envelope("501", "Eşzamanlı teslim");
    const deliveries = await Promise.all([receiveTransfer(pool, source, context), receiveTransfer(pool, source, context)]);
    expect(deliveries[0].id).toBe(deliveries[1].id);
    expect(deliveries[0].status).toBe("pending_mapping");
    expect(await count("SELECT COUNT(*) AS total FROM bypusula_analysis WHERE id = ?", [deliveries[0].id])).toBe(1);
    await expect(receiveTransfer(pool, { ...source, company: { ...source.company, name: "Farklı snapshot" } }, context))
      .rejects.toMatchObject({ code: "snapshot_conflict" });
    expect((await openTransfer(pool, deliveries[0].id)).digest).toBe(deliveries[0].digest);
  });

  it("rejects an unrelated or inactive customer-project link without creating a task", async () => {
    const preview = await receiveTransfer(pool, envelope("502", "Eşleme reddi"), context);
    expect(preview.candidates.some((candidate) => candidate.projectId === unlinkedProjectId)).toBe(false);
    await expect(importTransfer(pool, { ...command(preview), projectId: unlinkedProjectId }, context))
      .rejects.toMatchObject({ code: "mapping_changed" });
    await pool.execute("UPDATE customer_project SET status = 'inactive' WHERE customer_id = ? AND project_id = ?", [customerId, projectId]);
    try {
      await expect(importTransfer(pool, command(preview), context)).rejects.toMatchObject({ code: "mapping_changed" });
      expect((await openTransfer(pool, preview.id)).status).toBe("pending_mapping");
    } finally {
      await pool.execute("UPDATE customer_project SET status = 'active' WHERE customer_id = ? AND project_id = ?", [customerId, projectId]);
    }
    expect(await count("SELECT COUNT(*) AS total FROM work_task WHERE title LIKE 'Eşleme reddi %'")).toBe(0);
  });

  it("creates each task once under concurrent imports and preserves completed, cancelled and archived work", async () => {
    const preview = await receiveTransfer(pool, envelope("503", "Eşzamanlı görev"), context);
    const results = await Promise.all([importTransfer(pool, command(preview), context), importTransfer(pool, command(preview), context)]);
    expect(results.flat().filter((result) => result.status === "created")).toHaveLength(3);
    expect(results.flat().filter((result) => result.status === "existing")).toHaveLength(3);
    const imported = (await openTransfer(pool, preview.id)).imported.sort((a, b) => a.key.localeCompare(b.key));
    expect(imported).toHaveLength(3);
    await updateTask(pool, imported[0].taskId, { version: 1, status: "done", title: "Elle düzenlenen tamamlanmış görev", priority: "high" }, context);
    await updateTask(pool, imported[1].taskId, { version: 1, status: "cancelled" }, context);
    await updateTask(pool, imported[2].taskId, { version: 1, status: "done" }, context);
    await pool.execute(`UPDATE work_task SET archive_reason = 'Sentetik arşiv', archived_at_utc = UTC_TIMESTAMP(6),
      archived_by_user_account_id = ?, updated_at_utc = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?`, [actorId, imported[2].taskId]);
    const taskSnapshot = async () => (await pool.execute<RowDataPacket[]>(
      `SELECT t.* FROM work_task t JOIN bypusula_task_link l ON l.task_id = t.id WHERE l.analysis_id = ? ORDER BY t.id`, [preview.id]))[0];
    const before = await taskSnapshot();
    expect((await importTransfer(pool, command(preview), context)).every((result) => result.status === "existing")).toBe(true);
    expect(await taskSnapshot()).toEqual(before);
    expect((await openTransfer(pool, preview.id)).mapping).toEqual({ customerId, projectId });
    expect(await count(`SELECT COUNT(*) AS total FROM audit_event a JOIN bypusula_task_link l ON l.task_id = a.entity_id
      WHERE l.analysis_id = ? AND a.action = 'task.created'`, [preview.id])).toBe(3);
  });

  it("rolls back task, project link and audit when a step fails, then resumes without duplicates", async () => {
    const preview = await receiveTransfer(pool, envelope("504", "Kısmi hata"), context);
    // This trigger exists only inside the disposable container and fails after
    // task + project + audit inserts, exercising the real transaction rollback.
    await pool.query(`CREATE TRIGGER bypusula_test_failure BEFORE INSERT ON bypusula_task_link FOR EACH ROW
      BEGIN IF NEW.step_key = 'PRG-GOV-01/IMPLEMENTATION_ACTION_02' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic step failure'; END IF; END`);
    try {
      expect((await importTransfer(pool, command(preview), context)).map((result) => result.status)).toEqual(["created", "failed", "created"]);
    } finally { await pool.query("DROP TRIGGER bypusula_test_failure"); }
    expect(await count("SELECT COUNT(*) AS total FROM work_task WHERE title LIKE 'Kısmi hata %'")).toBe(2);
    expect(await count("SELECT COUNT(*) AS total FROM bypusula_task_link WHERE analysis_id = ?", [preview.id])).toBe(2);
    expect(await count("SELECT COUNT(*) AS total FROM audit_event WHERE action = 'task.created' AND JSON_UNQUOTE(JSON_EXTRACT(after_summary, '$.title')) = 'Kısmi hata 2'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS total FROM work_task_project p LEFT JOIN work_task t ON p.task_id = t.id WHERE t.id IS NULL")).toBe(0);
    expect((await importTransfer(pool, command(preview), context)).map((result) => result.status)).toEqual(["existing", "created", "existing"]);
    expect(await count("SELECT COUNT(*) AS total FROM work_task WHERE title LIKE 'Kısmi hata %'")).toBe(3);
  });
});
