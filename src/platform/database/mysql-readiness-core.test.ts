// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MYSQL_SELECT_ONE_SQL,
  runMySqlSelectOneProbe,
} from "@/platform/database/mysql-readiness-core";

describe("MySQL SELECT 1 readiness probe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a fixed query with a bounded driver timeout", async () => {
    const query = vi.fn(async () => [[{ readiness_ok: 1 }], []]);

    await expect(
      runMySqlSelectOneProbe(query, {
        queryTimeoutMs: 120,
        deadlineMs: 150,
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith({
      sql: MYSQL_SELECT_ONE_SQL,
      timeout: 120,
    });
  });

  it("returns false for an unexpected result or driver failure", async () => {
    const secretSentinel = "driver-secret-sentinel";

    await expect(
      runMySqlSelectOneProbe(async () => [[{ readiness_ok: 0 }], []]),
    ).resolves.toBe(false);
    await expect(
      runMySqlSelectOneProbe(async () => {
        throw new Error(secretSentinel);
      }),
    ).resolves.toBe(false);
  });

  it("returns false when the outer deadline expires", async () => {
    vi.useFakeTimers();
    const result = runMySqlSelectOneProbe(
      () => new Promise(() => undefined),
      { queryTimeoutMs: 25, deadlineMs: 50 },
    );

    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toBe(false);
  });
});
