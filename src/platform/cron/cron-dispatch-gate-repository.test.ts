import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acquireCronDispatchPermit,
  CronDispatchGateError,
} from "./cron-dispatch-gate-repository";

const gateKey = "platform-cron-dispatch-v1";
const now = new Date("2026-08-30T10:00:00.000Z");
const nowSql = "2026-08-30 10:00:00.000000";

type GateFixture = Readonly<{
  created_at_utc: string;
  gate_key: string;
  last_permitted_at_utc: string;
  state: string;
  updated_at_utc: string;
}>;

function activeGate(lastPermittedAtUtc = nowSql): GateFixture {
  return {
    created_at_utc: lastPermittedAtUtc,
    gate_key: gateKey,
    last_permitted_at_utc: lastPermittedAtUtc,
    state: "active",
    updated_at_utc: lastPermittedAtUtc,
  };
}

function resultHeader(affectedRows: number): ResultSetHeader {
  return {
    affectedRows,
    changedRows: affectedRows,
    fieldCount: 0,
    info: "",
    insertId: 0,
    serverStatus: 0,
    warningStatus: 0,
  } as ResultSetHeader;
}

function fakePool(selectResults: GateFixture[][]): {
  connection: PoolConnection;
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
} {
  const pendingSelects = [...selectResults];
  const query = vi.fn(async (statement: string | { sql: string }) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (sql.includes("FROM cron_dispatch_gate")) {
      return [pendingSelects.shift() ?? [], []];
    }
    if (sql.startsWith("INSERT INTO cron_dispatch_gate")) {
      return [resultHeader(1), []];
    }
    if (sql.startsWith("UPDATE cron_dispatch_gate")) {
      return [resultHeader(1), []];
    }
    return [[], []];
  });
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    query,
    release: vi.fn(),
    rollback: vi.fn(async () => undefined),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(async () => connection),
  } as unknown as Pool;

  return { connection, pool, query };
}

describe("durable cron dispatch gate repository", () => {
  it("creates and verifies the first durable permit without interpolating the key", async () => {
    const fixture = fakePool([[], [activeGate()]]);

    await expect(
      acquireCronDispatchPermit(fixture.pool, {
        gateKey,
        minimumIntervalSeconds: 60,
        now: () => now,
      }),
    ).resolves.toBe("permit");

    const gateQueries = fixture.query.mock.calls.filter(([statement]) => {
      const sql =
        typeof statement === "string"
          ? statement
          : (statement as { sql: string }).sql;
      return sql.includes("cron_dispatch_gate");
    });
    expect(gateQueries).toHaveLength(3);
    for (const [statement] of gateQueries) {
      const sql = (statement as { sql: string }).sql;
      expect(sql).not.toContain(gateKey);
    }
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
    expect(fixture.connection.rollback).not.toHaveBeenCalled();
  });

  it("suppresses an existing permit inside the window without writing", async () => {
    const fixture = fakePool([[activeGate()]]);

    await expect(
      acquireCronDispatchPermit(fixture.pool, {
        gateKey,
        minimumIntervalSeconds: 60,
        now: () => new Date("2026-08-30T10:00:59.999Z"),
      }),
    ).resolves.toBe("suppressed");

    expect(
      fixture.query.mock.calls.some(([statement]) => {
        const sql =
          typeof statement === "string"
            ? statement
            : (statement as { sql: string }).sql;
        return /^(?:INSERT INTO|UPDATE) cron_dispatch_gate/u.test(sql);
      }),
    ).toBe(false);
  });

  it.each([
    "",
    " leading",
    "trailing ",
    "internal space",
    "tab\tkey",
    "unicode-ğ",
  ])("rejects non-canonical key %j before resolving a connection", async (invalidKey) => {
    const getConnection = vi.fn();
    const pool = { getConnection } as unknown as Pool;

    await expect(
      acquireCronDispatchPermit(pool, {
        gateKey: invalidKey,
        minimumIntervalSeconds: 60,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(CronDispatchGateError);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it.each([59, 86_401, 60.5, Number.NaN])(
    "rejects an unsafe interval %s before resolving a connection",
    async (minimumIntervalSeconds) => {
      const getConnection = vi.fn();
      const pool = { getConnection } as unknown as Pool;

      await expect(
        acquireCronDispatchPermit(pool, {
          gateKey,
          minimumIntervalSeconds,
          now: () => now,
        }),
      ).rejects.toBeInstanceOf(CronDispatchGateError);
      expect(getConnection).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the persisted state is malformed or from the future", async () => {
    const malformed = fakePool([
      [
        {
          ...activeGate("2026-08-30 10:01:00.000000"),
          state: "broken",
        },
      ],
    ]);
    await expect(
      acquireCronDispatchPermit(malformed.pool, {
        gateKey,
        minimumIntervalSeconds: 60,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(CronDispatchGateError);
    expect(malformed.connection.rollback).toHaveBeenCalledOnce();

    const future = fakePool([
      [activeGate("2026-08-30 10:01:00.000000")],
    ]);
    await expect(
      acquireCronDispatchPermit(future.pool, {
        gateKey,
        minimumIntervalSeconds: 60,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(CronDispatchGateError);
  });

  it("fails closed when an inserted row cannot be read back", async () => {
    const fixture = fakePool([[], []]);

    await expect(
      acquireCronDispatchPermit(fixture.pool, {
        gateKey,
        minimumIntervalSeconds: 60,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(CronDispatchGateError);
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
  });

  it("collapses connection errors to the generic gate error", async () => {
    const pool = {
      getConnection: vi.fn(async () => {
        throw new Error("sensitive database detail");
      }),
    } as unknown as Pool;

    await expect(
      acquireCronDispatchPermit(pool, {
        gateKey,
        minimumIntervalSeconds: 60,
        now: () => now,
      }),
    ).rejects.toEqual(new CronDispatchGateError());
  });
});
