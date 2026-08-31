import "server-only";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalAsciiKey } from "@/platform/validation/canonical-identifiers";

export const CRON_DISPATCH_GATE_KEY_MAX_LENGTH = 128;
export const CRON_DISPATCH_GATE_MIN_INTERVAL_SECONDS = 60;
export const CRON_DISPATCH_GATE_MAX_INTERVAL_SECONDS = 86_400;

const CRON_DISPATCH_GATE_QUERY_TIMEOUT_MS = 1_000;
const ACTIVE_GATE_STATE = "active";
const SQL_DATE_TIME_6_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{6})$/u;

const SELECT_GATE_SQL = `SELECT gate_key, state,
       DATE_FORMAT(last_permitted_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS last_permitted_at_utc,
       DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS created_at_utc,
       DATE_FORMAT(updated_at_utc, '%Y-%m-%d %H:%i:%s.%f') AS updated_at_utc
  FROM cron_dispatch_gate
 WHERE gate_key = ?
 FOR UPDATE`;

const INSERT_GATE_SQL = `INSERT INTO cron_dispatch_gate
  (gate_key, state, last_permitted_at_utc, created_at_utc, updated_at_utc)
VALUES (?, 'active', ?, ?, ?)`;

const UPDATE_GATE_SQL = `UPDATE cron_dispatch_gate
   SET last_permitted_at_utc = ?, updated_at_utc = ?
 WHERE gate_key = ?
   AND state = 'active'
   AND last_permitted_at_utc = ?
   AND updated_at_utc = ?
   AND created_at_utc <= last_permitted_at_utc`;

type GateRow = RowDataPacket & {
  created_at_utc: unknown;
  gate_key: unknown;
  last_permitted_at_utc: unknown;
  state: unknown;
  updated_at_utc: unknown;
};

export type CronDispatchGateDecision = "permit" | "suppressed";

export type AcquireCronDispatchPermitInput = Readonly<{
  gateKey: string;
  minimumIntervalSeconds: number;
  now?: () => Date;
}>;

export class CronDispatchGateError extends Error {
  constructor() {
    super("Cron dispatch gate operation failed.");
    this.name = "CronDispatchGateError";
  }
}

function failGate(): never {
  throw new CronDispatchGateError();
}

function validIntervalSeconds(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= CRON_DISPATCH_GATE_MIN_INTERVAL_SECONDS &&
    value <= CRON_DISPATCH_GATE_MAX_INTERVAL_SECONDS
  );
}

function parseUtcDateTime6(value: unknown): number {
  if (typeof value !== "string") failGate();

  const match = SQL_DATE_TIME_6_PATTERN.exec(value);
  if (match === null) failGate();

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, micros] =
    match;
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined ||
    micros === undefined
  ) {
    failGate();
  }

  const parts = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    failGate();
  }

  const wholeSecond = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    0,
  );
  const instant = wholeSecond + Number(micros) / 1_000;
  const roundTrip = new Date(wholeSecond);
  if (
    !Number.isFinite(instant) ||
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second
  ) {
    failGate();
  }

  return instant;
}

function validateGateRow(
  rows: GateRow[],
  expectedGateKey: string,
): { lastPermittedAtMs: number; lastPermittedAtUtc: string } {
  const row = rows.length === 1 ? rows[0] : undefined;
  if (
    row === undefined ||
    row.gate_key !== expectedGateKey ||
    row.state !== ACTIVE_GATE_STATE ||
    typeof row.last_permitted_at_utc !== "string" ||
    typeof row.created_at_utc !== "string" ||
    typeof row.updated_at_utc !== "string"
  ) {
    failGate();
  }

  const createdAtMs = parseUtcDateTime6(row.created_at_utc);
  const lastPermittedAtMs = parseUtcDateTime6(row.last_permitted_at_utc);
  const updatedAtMs = parseUtcDateTime6(row.updated_at_utc);
  if (
    createdAtMs > lastPermittedAtMs ||
    lastPermittedAtMs !== updatedAtMs ||
    row.last_permitted_at_utc !== row.updated_at_utc
  ) {
    failGate();
  }

  return {
    lastPermittedAtMs,
    lastPermittedAtUtc: row.last_permitted_at_utc,
  };
}

async function selectGate(
  connection: PoolConnection,
  gateKey: string,
): Promise<GateRow[]> {
  const [rows] = await connection.query<GateRow[]>({
    sql: SELECT_GATE_SQL,
    timeout: CRON_DISPATCH_GATE_QUERY_TIMEOUT_MS,
    values: [gateKey],
  });
  return rows;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY" &&
    "errno" in error &&
    error.errno === 1062
  );
}

async function acquireOnce(
  pool: Pool,
  gateKey: string,
  minimumIntervalMs: number,
  nowMs: number,
  nowUtc: string,
): Promise<CronDispatchGateDecision> {
  return withUtcTransaction(pool, async (connection) => {
    const initialRows = await selectGate(connection, gateKey);

    if (initialRows.length === 0) {
      const [inserted] = await connection.query<ResultSetHeader>({
        sql: INSERT_GATE_SQL,
        timeout: CRON_DISPATCH_GATE_QUERY_TIMEOUT_MS,
        values: [gateKey, nowUtc, nowUtc, nowUtc],
      });
      if (inserted.affectedRows !== 1) failGate();

      const insertedRow = validateGateRow(
        await selectGate(connection, gateKey),
        gateKey,
      );
      if (
        insertedRow.lastPermittedAtMs !== nowMs ||
        insertedRow.lastPermittedAtUtc !== nowUtc
      ) {
        failGate();
      }
      return "permit";
    }

    const gate = validateGateRow(initialRows, gateKey);
    if (gate.lastPermittedAtMs > nowMs) failGate();
    if (nowMs - gate.lastPermittedAtMs < minimumIntervalMs) {
      return "suppressed";
    }

    const [updated] = await connection.query<ResultSetHeader>({
      sql: UPDATE_GATE_SQL,
      timeout: CRON_DISPATCH_GATE_QUERY_TIMEOUT_MS,
      values: [
        nowUtc,
        nowUtc,
        gateKey,
        gate.lastPermittedAtUtc,
        gate.lastPermittedAtUtc,
      ],
    });
    if (updated.affectedRows !== 1) failGate();
    return "permit";
  });
}

/**
 * Acquires a durable frequency permit. All operational failures are collapsed
 * to a generic error so database or persisted-state details cannot escape.
 */
export async function acquireCronDispatchPermit(
  pool: Pool,
  input: AcquireCronDispatchPermitInput,
): Promise<CronDispatchGateDecision> {
  let gateKey: string;
  let now: Date;
  try {
    gateKey = assertCanonicalAsciiKey(
      input.gateKey,
      CRON_DISPATCH_GATE_KEY_MAX_LENGTH,
    );
    if (!validIntervalSeconds(input.minimumIntervalSeconds)) failGate();
    now = (input.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) failGate();
  } catch {
    failGate();
  }

  const minimumIntervalMs = input.minimumIntervalSeconds * 1_000;
  const nowMs = now.getTime();
  const nowUtc = toUtcDateTime6(now);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await acquireOnce(
        pool,
        gateKey,
        minimumIntervalMs,
        nowMs,
        nowUtc,
      );
    } catch (error) {
      if (attempt === 0 && isDuplicateKeyError(error)) continue;
      failGate();
    }
  }

  return failGate();
}
