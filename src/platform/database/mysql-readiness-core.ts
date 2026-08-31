export const MYSQL_SELECT_ONE_SQL = "SELECT 1 AS readiness_ok";
export const MYSQL_QUERY_TIMEOUT_MS = 2_000;
export const MYSQL_PROBE_DEADLINE_MS = 2_500;

export type MySqlReadinessQuery = (options: {
  sql: string;
  timeout: number;
}) => Promise<unknown>;

type ProbeTiming = {
  deadlineMs?: number;
  queryTimeoutMs?: number;
};

function hasReadyRow(result: unknown): boolean {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    return false;
  }

  const firstRow: unknown = result[0][0];
  return (
    typeof firstRow === "object" &&
    firstRow !== null &&
    "readiness_ok" in firstRow &&
    (firstRow as { readiness_ok: unknown }).readiness_ok === 1
  );
}

export async function runMySqlSelectOneProbe(
  query: MySqlReadinessQuery,
  timing: ProbeTiming = {},
): Promise<boolean> {
  const deadlineMs = timing.deadlineMs ?? MYSQL_PROBE_DEADLINE_MS;
  const queryTimeoutMs = timing.queryTimeoutMs ?? MYSQL_QUERY_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const queryResult = Promise.resolve()
    .then(() =>
      query({
        sql: MYSQL_SELECT_ONE_SQL,
        timeout: queryTimeoutMs,
      }),
    )
    .then(hasReadyRow)
    .catch(() => false);

  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), deadlineMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([queryResult, deadline]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
