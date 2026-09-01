import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const verificationMigrationPath = resolve(
  process.cwd(),
  "drizzle",
  "0000_platform_migration_verification.sql",
);
const platformMigrationPath = resolve(
  process.cwd(),
  "drizzle",
  "0001_platform_job_outbox_audit.sql",
);
const platformConstraintMigrationPath = resolve(
  process.cwd(),
  "drizzle",
  "0002_platform_state_constraints.sql",
);
const cronDispatchGateMigrationPath = resolve(
  process.cwd(),
  "drizzle",
  "0003_platform_cron_dispatch_gate.sql",
);
const customerMigrationPath = resolve(
  process.cwd(),
  "drizzle",
  "0004_customer.sql",
);
const verificationMigrationSql = readFileSync(
  verificationMigrationPath,
  "utf8",
);
const platformMigrationSql = readFileSync(platformMigrationPath, "utf8");
const platformConstraintMigrationSql = readFileSync(
  platformConstraintMigrationPath,
  "utf8",
);
const cronDispatchGateMigrationSql = readFileSync(
  cronDispatchGateMigrationPath,
  "utf8",
);
const customerMigrationSql = readFileSync(customerMigrationPath, "utf8");

function createdTables(sql: string): string[] {
  return Array.from(
    sql.matchAll(
      /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`([^`]+)`/giu,
    ),
    (match) => match[1] ?? "",
  );
}

describe("platform migration SQL policy", () => {
  it("creates only the explicitly non-domain verification table", () => {
    expect(createdTables(verificationMigrationSql)).toEqual([
      "_platform_migration_verification",
    ]);
    expect(verificationMigrationSql).not.toMatch(
      /\bIF\s+NOT\s+EXISTS\b/iu,
    );
    expect(verificationMigrationSql).not.toMatch(
      /\b(?:DROP|TRUNCATE|ALTER|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/iu,
    );
    expect(verificationMigrationSql).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });

  it("pins the MariaDB storage and correctness contract", () => {
    expect(verificationMigrationSql).toMatch(/\bENGINE\s*=\s*InnoDB\b/iu);
    expect(verificationMigrationSql).toMatch(
      /\bDEFAULT\s+CHARACTER\s+SET\s*=\s*utf8mb4\b/iu,
    );
    expect(verificationMigrationSql).toMatch(
      /\bDECIMAL\s*\(\s*19\s*,\s*4\s*\)/iu,
    );
    expect(verificationMigrationSql).toMatch(/\bTIMESTAMP\s*\(\s*6\s*\)/iu);
    expect(verificationMigrationSql).toMatch(
      /`idempotency_key`[\s\S]*?COLLATE\s+utf8mb4_bin[\s\S]*?UNIQUE\s+KEY\s+`uq_platform_migration_verification_idempotency`/iu,
    );
    expect(verificationMigrationSql).toContain(
      "Platform verification only; not customer or finance data",
    );
  });

  it("adds exactly the four approved platform infrastructure tables", () => {
    expect(createdTables(platformMigrationSql).sort()).toEqual([
      "audit_event",
      "job_run",
      "outbox_event",
      "scheduled_job",
    ]);
    expect(platformMigrationSql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu);
    expect(platformMigrationSql).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
    expect(platformMigrationSql).not.toMatch(/\bSKIP\s+LOCKED\b/iu);
    expect(platformMigrationSql).not.toMatch(
      /`(?:user|workspace|organization|brand|project|customer|task|finance)(?:_|`)/iu,
    );
    expect(platformMigrationSql).not.toMatch(
      /\b(?:money|amount|price|currency|decimal|numeric)\b/iu,
    );
  });

  it("pins the platform table engine, collation, and UTC time precision", () => {
    expect(
      platformMigrationSql.match(/\bENGINE\s*=\s*InnoDB\b/giu),
    ).toHaveLength(4);
    expect(
      platformMigrationSql.match(
        /\bDEFAULT\s+CHARACTER\s+SET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_unicode_ci\b/giu,
      ),
    ).toHaveLength(4);

    const utcColumns = Array.from(
      platformMigrationSql.matchAll(
        /`([a-z_]+_at_utc)`\s+datetime\(6\)/giu,
      ),
      (match) => match[1],
    );
    expect(utcColumns).toHaveLength(13);
    expect(platformMigrationSql).not.toMatch(/\bTIMESTAMP\s*\(/iu);
  });

  it("uses binary-exact ASCII fencing and idempotency fields", () => {
    const exactFields = [
      "id",
      "job_id",
      "actor_id",
      "entity_id",
      "idempotency_key",
      "lease_token",
      "correlation_id",
    ];

    for (const field of exactFields) {
      const occurrences = platformMigrationSql.match(
        new RegExp(
          `\`${field}\`[^\\n,]*CHARACTER SET ascii COLLATE ascii_bin`,
          "giu",
        ),
      );
      expect(occurrences?.length, field).toBeGreaterThan(0);
    }

    expect(platformMigrationSql).toMatch(
      /CONSTRAINT\s+`uq_scheduled_job_type_idempotency`\s+UNIQUE\(`job_type`,`idempotency_key`\)/iu,
    );
    expect(platformMigrationSql).toMatch(
      /CONSTRAINT\s+`uq_outbox_event_idempotency`\s+UNIQUE\(`idempotency_key`\)/iu,
    );
    expect(platformMigrationSql).toMatch(
      /CONSTRAINT\s+`uq_(?:scheduled_job|outbox_event)_lease_token`\s+UNIQUE\(`lease_token`\)/iu,
    );
  });

  it("preserves job history through a restrictive named foreign key", () => {
    expect(platformMigrationSql).toMatch(
      /ALTER\s+TABLE\s+`job_run`\s+ADD\s+CONSTRAINT\s+`fk_job_run_scheduled_job`\s+FOREIGN\s+KEY\s+\(`job_id`\)\s+REFERENCES\s+`scheduled_job`\(`id`\)\s+ON\s+DELETE\s+restrict\s+ON\s+UPDATE\s+restrict/iu,
    );
    expect(platformMigrationSql.match(/\bFOREIGN\s+KEY\b/giu)).toHaveLength(1);
    expect(platformMigrationSql).not.toMatch(/\b(?:TRIGGER|PROCEDURE)\b/iu);
  });

  it("adds only the approved forward state constraints in 0002", () => {
    expect(createdTables(platformConstraintMigrationSql)).toEqual([]);
    expect(platformConstraintMigrationSql).not.toMatch(
      /\b(?:DROP|TRUNCATE|RENAME|DELETE|UPDATE|INSERT|REPLACE|CREATE)\b/iu,
    );
    expect(platformConstraintMigrationSql).not.toMatch(
      /\b(?:TRIGGER|PROCEDURE|SKIP\s+LOCKED)\b/iu,
    );

    const alteredTables = Array.from(
      platformConstraintMigrationSql.matchAll(/ALTER\s+TABLE\s+`([^`]+)`/giu),
      (match) => match[1],
    );
    expect(new Set(alteredTables)).toEqual(
      new Set(["audit_event", "job_run", "outbox_event", "scheduled_job"]),
    );
    expect(platformConstraintMigrationSql.match(/\bADD\s+CONSTRAINT\b/giu)).toHaveLength(
      12,
    );
    expect(platformConstraintMigrationSql.match(/\bCHECK\s*\(/giu)).toHaveLength(
      12,
    );
  });

  it("pins bounded attempts, status state machines, and complete lease shapes", () => {
    for (const tableName of ["scheduled_job", "outbox_event"]) {
      expect(platformConstraintMigrationSql).toMatch(
        new RegExp(
          "chk_" +
            tableName +
            "_attempt_bounds[\\s\\S]*?`" +
            tableName +
            "`\\.`max_attempts` >= 1[\\s\\S]*?`" +
            tableName +
            "`\\.`attempt_count` <= `" +
            tableName +
            "`\\.`max_attempts`",
          "iu",
        ),
      );
      expect(platformConstraintMigrationSql).toMatch(
        new RegExp(
          "chk_" +
            tableName +
            "_lease_shape[\\s\\S]*?`status` = 'leased'[\\s\\S]*?`lease_owner` IS NOT NULL[\\s\\S]*?`lease_token` IS NOT NULL[\\s\\S]*?`lease_expires_at_utc` IS NOT NULL[\\s\\S]*?`status` <> 'leased'[\\s\\S]*?`lease_owner` IS NULL[\\s\\S]*?`lease_token` IS NULL[\\s\\S]*?`lease_expires_at_utc` IS NULL",
          "iu",
        ),
      );
    }

    expect(platformConstraintMigrationSql).toContain(
      "IN ('pending', 'retry', 'leased', 'succeeded', 'dead_letter')",
    );
    expect(platformConstraintMigrationSql).toContain(
      "IN ('pending', 'retry', 'leased', 'delivered', 'dead_letter')",
    );
    expect(platformConstraintMigrationSql).toMatch(
      /chk_job_run_outcome_state[\s\S]*?outcome` = 'running'[\s\S]*?completed_at_utc` IS NULL[\s\S]*?IN \('succeeded', 'retry', 'dead_letter', 'lease_expired'\)[\s\S]*?completed_at_utc` IS NOT NULL/iu,
    );
    expect(platformConstraintMigrationSql).toMatch(
      /chk_audit_event_actor_type[\s\S]*?actor_type` IN \('system', 'user'\)/iu,
    );
  });

  it("enforces canonical lower-case UUID and printable whitespace-free ASCII identities", () => {
    expect(
      platformConstraintMigrationSql.match(
        /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/gu,
      ),
    ).toHaveLength(10);
    expect(
      platformConstraintMigrationSql.match(/\^\[!-~\]\+\$/gu),
    ).toHaveLength(14);
    expect(
      platformConstraintMigrationSql.match(/\bBINARY\s+`/giu),
    ).toHaveLength(24);
    expect(platformConstraintMigrationSql).not.toMatch(/\bVARBINARY\b/iu);
  });

  it("adds only the durable cron dispatch gate in forward migration 0003", () => {
    expect(createdTables(cronDispatchGateMigrationSql)).toEqual([
      "cron_dispatch_gate",
    ]);
    expect(cronDispatchGateMigrationSql).not.toMatch(
      /\bIF\s+NOT\s+EXISTS\b/iu,
    );
    expect(cronDispatchGateMigrationSql).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|ALTER|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
    expect(cronDispatchGateMigrationSql).not.toMatch(
      /\b(?:TRIGGER|PROCEDURE|SKIP\s+LOCKED)\b/iu,
    );
    expect(cronDispatchGateMigrationSql).not.toMatch(
      /`(?:user|workspace|organization|brand|project|customer|task|finance)(?:_|`)/iu,
    );
  });

  it("pins the cron gate storage, UTC, canonical key, and state contracts", () => {
    expect(cronDispatchGateMigrationSql).toMatch(/\bENGINE\s*=\s*InnoDB\b/iu);
    expect(cronDispatchGateMigrationSql).toMatch(
      /\bDEFAULT\s+CHARACTER\s+SET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_unicode_ci\b/iu,
    );
    expect(cronDispatchGateMigrationSql).toMatch(
      /`gate_key`\s+varchar\(128\)\s+CHARACTER SET ascii COLLATE ascii_bin\s+NOT NULL/iu,
    );
    expect(cronDispatchGateMigrationSql).toMatch(
      /`state`\s+varchar\(16\)\s+CHARACTER SET ascii COLLATE ascii_bin\s+NOT NULL\s+DEFAULT 'active'/iu,
    );
    expect(cronDispatchGateMigrationSql.match(/\bdatetime\(6\)/giu)).toHaveLength(
      3,
    );
    expect(cronDispatchGateMigrationSql).not.toMatch(/\bTIMESTAMP\s*\(/iu);
    expect(cronDispatchGateMigrationSql).toMatch(
      /PRIMARY KEY\(`gate_key`\)/iu,
    );
    expect(cronDispatchGateMigrationSql).toMatch(
      /chk_cron_dispatch_gate_key_format[\s\S]*?\^\[!-~\]\+\$/iu,
    );
    expect(cronDispatchGateMigrationSql).toMatch(
      /chk_cron_dispatch_gate_state[\s\S]*?BINARY\s+`cron_dispatch_gate`\.`state`\s*=\s*BINARY\s+'active'/iu,
    );
    expect(cronDispatchGateMigrationSql).toMatch(
      /chk_cron_dispatch_gate_timeline[\s\S]*?`created_at_utc`\s*<=\s*`cron_dispatch_gate`\.`last_permitted_at_utc`[\s\S]*?`last_permitted_at_utc`\s*=\s*`cron_dispatch_gate`\.`updated_at_utc`/iu,
    );
  });

  it("adds the first customer domain table with Unicode and canonical identity contracts", () => {
    expect(createdTables(customerMigrationSql)).toEqual(["customer"]);
    expect(customerMigrationSql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu);
    expect(customerMigrationSql).not.toMatch(
      /(?:^|;)\s*(?:DROP|TRUNCATE|ALTER|RENAME|DELETE|UPDATE|INSERT|REPLACE)\b/imu,
    );
    expect(customerMigrationSql).toMatch(/\bENGINE\s*=\s*InnoDB\b/iu);
    expect(customerMigrationSql).toMatch(
      /\bDEFAULT\s+CHARACTER\s+SET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_unicode_ci\b/iu,
    );
    expect(customerMigrationSql).toMatch(
      /`id`\s+char\(36\)\s+CHARACTER SET ascii COLLATE ascii_bin/iu,
    );
    expect(customerMigrationSql).toMatch(
      /`short_code`\s+varchar\(32\)\s+CHARACTER SET ascii COLLATE ascii_bin/iu,
    );
    expect(customerMigrationSql).toContain("chk_customer_short_code");
    expect(customerMigrationSql).toContain("uq_customer_short_code");
  });
});
