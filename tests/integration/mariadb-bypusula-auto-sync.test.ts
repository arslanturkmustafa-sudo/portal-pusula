import { spawn } from "node:child_process";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { exampleEnvelope } from "@/features/bypusula/fixtures.test-support";
import { approveAutomaticTransfer, openTransfer } from "@/features/bypusula/service";
import { advanceAutomaticTransfer, receiveAutomaticTransfer } from "@/features/bypusula/sync-service";
import { registerMySqlPoolDatabase } from "@/platform/database/mysql-session-contract";
import { updateTask } from "@/features/tasks/service";

const enabled = process.env.PORTAL_PUSULA_DISPOSABLE_MARIADB === "1";
const actorId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const plannedId = "44444444-4444-4444-8444-444444444444";
const configuration = {keyId:"synthetic",secret:"a".repeat(64),instanceId:exampleEnvelope.instanceId,accountId:exampleEnvelope.accountId,actorId};
const context = {actorId,correlationId:"synthetic-auto-sync"};

describe.skipIf(!enabled)("automatic ByPusula transfer on disposable MariaDB", () => {
  let pool: Pool;
  beforeAll(async () => {
    const expected = {DB_HOST:"127.0.0.1",DB_NAME:"portal_pusula_migration_test",DB_USER:"portal_pusula_test",DB_PASSWORD:"portal-pusula-local-test-only"};
    const port = Number(process.env.DB_PORT);
    if (Object.entries(expected).some(([key,value])=>process.env[key]!==value) || !Number.isInteger(port) || port<1024 || port>65535 || port===3306) throw new Error("Disposable runner only.");
    const environment: NodeJS.ProcessEnv = {...expected,DB_PORT:String(port),NODE_ENV:"test"};
    for (const key of ["PATH","Path","SystemRoot","SYSTEMROOT","TEMP","TMP","WINDIR"]) if (process.env[key]) environment[key]=process.env[key];
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(process.execPath,["scripts/migrate.mjs"],{env:environment,stdio:"ignore",windowsHide:true});
      child.once("error",()=>reject(new Error("Disposable migration startup failed.")));
      child.once("exit",code=>code===0?resolve():reject(new Error("Disposable migration failed.")));
    });
    pool=mysql.createPool({host:expected.DB_HOST,port,database:expected.DB_NAME,user:expected.DB_USER,password:expected.DB_PASSWORD,charset:"utf8mb4",timezone:"Z",dateStrings:true,connectionLimit:4,multipleStatements:false});
    registerMySqlPoolDatabase(pool,expected.DB_NAME);
    await pool.execute(`INSERT INTO user_account (id,email,display_name,password_hash,role,status,password_changed_at_utc,created_at_utc,updated_at_utc)
      VALUES (?,'sync@example.invalid','Sentetik Aktör',?,'owner','active','2026-01-01','2026-01-01','2026-01-01')`,[actorId,`scrypt:32768:8:1:${"a".repeat(22)}:${"b".repeat(86)}`]);
    await pool.execute("INSERT INTO customer (id,display_name,short_code) VALUES (?,'Sentetik Firma','AUTO_TEST')",[customerId]);
    await pool.execute(`INSERT INTO project (id,display_name,short_code,project_type,status) VALUES
      (?,'Aktif Test Projesi','AUTO_ACTIVE','consulting','active'),(?,'Planlanan Test Projesi','AUTO_PLANNED','consulting','planned')`,[projectId,plannedId]);
    await pool.execute("INSERT INTO customer_project (customer_id,project_id) VALUES (?,?),(?,?)",[customerId,projectId,customerId,plannedId]);
  },30000);
  afterAll(async()=>{if(pool)await pool.end();});

  it("requires an active project choice, retains approval, resumes partial batches and never duplicates tasks",async()=>{
    const source=structuredClone(exampleEnvelope);
    source.programs[0].steps=Array.from({length:27},(_,index)=>({code:`IMPLEMENTATION_ACTION_${String(index+1).padStart(2,"0")}`,sequence:index+1,title:`Otomatik adım ${index+1}`,description:"Sentetik uygulama açıklaması.",priority:"normal"}));
    const pending=await receiveAutomaticTransfer(pool,source,configuration,context.correlationId);
    expect(pending).toMatchObject({status:"pending_mapping",completed:0,total:27});
    const preview=await openTransfer(pool,pending.analysisId);
    expect(preview.candidates.map(item=>item.projectId)).toEqual([projectId]);
    const approval={action:"approve_sync",id:preview.id,digest:preview.digest,customerId,projectId};
    await expect(approveAutomaticTransfer(pool,{...approval,projectId:plannedId},context)).rejects.toMatchObject({code:"mapping_changed"});
    expect((await receiveAutomaticTransfer(pool,source,configuration,context.correlationId)).completed).toBe(0);
    await approveAutomaticTransfer(pool,approval,context);
    expect((await openTransfer(pool,preview.id)).automation.approved).toBe(true);
    await pool.query(`CREATE TRIGGER bypusula_auto_failure BEFORE INSERT ON bypusula_task_link FOR EACH ROW
      BEGIN IF NEW.step_key='PRG-GOV-01/IMPLEMENTATION_ACTION_02' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic rollback'; END IF; END`);
    try {
      expect(await advanceAutomaticTransfer(pool,preview.id,configuration,context.correlationId)).toMatchObject({status:"processing",completed:24,total:27});
    } finally {await pool.query("DROP TRIGGER bypusula_auto_failure");}
    expect(await receiveAutomaticTransfer(pool,source,configuration,context.correlationId)).toMatchObject({status:"synced",completed:27,total:27});
    const imported=(await openTransfer(pool,preview.id)).imported;
    await updateTask(pool,imported[0].taskId,{version:1,status:"done",title:"Elle düzenlendi"},context);
    expect((await receiveAutomaticTransfer(pool,source,configuration,context.correlationId)).status).toBe("synced");
    const [counts]=await pool.query<(RowDataPacket & {total:number})[]>("SELECT COUNT(*) AS total FROM work_task");
    expect(Number(counts[0].total)).toBe(27);
    const [task]=await pool.execute<RowDataPacket[]>("SELECT status,title FROM work_task WHERE id=?",[imported[0].taskId]);
    expect(task[0]).toMatchObject({status:"done",title:"Elle düzenlendi"});
    await expect(receiveAutomaticTransfer(pool,{...source,company:{...source.company,name:"Changed"}},configuration,context.correlationId)).rejects.toMatchObject({code:"snapshot_conflict"});
    await pool.execute("UPDATE user_account SET status='disabled' WHERE id=?",[actorId]);
    await expect(receiveAutomaticTransfer(pool,source,configuration,context.correlationId)).rejects.toThrow("Sync access unavailable");
  },30000);
});
