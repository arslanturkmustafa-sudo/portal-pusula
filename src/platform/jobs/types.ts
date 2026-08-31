import type { PoolConnection } from "mysql2/promise";

export type ClaimedJob = Readonly<{
  attemptNo: number;
  correlationId: string;
  id: string;
  jobType: string;
  leaseOwner: string;
  leaseToken: string;
  maxAttempts: number;
  payload: unknown;
  payloadSchemaVersion: number;
}>;

export type JobHandlerContext = Readonly<{
  connection: PoolConnection;
  job: ClaimedJob;
  occurredAtUtc: string;
}>;

export type JobHandler = (context: JobHandlerContext) => Promise<void>;

export type JobRegistry = ReadonlyMap<string, JobHandler>;

export type JobExecutionOutcome =
  | "dead_letter"
  | "retry"
  | "stale"
  | "succeeded";

export type JobErrorCode =
  | "handler_not_registered"
  | "lease_expired"
  | "platform_operation_failed"
  | "unexpected_error";

export class SafeJobHandlerError extends Error {
  readonly errorCode: JobErrorCode;

  constructor(errorCode: JobErrorCode) {
    super("Job handler failed safely.");
    this.name = "SafeJobHandlerError";
    this.errorCode = errorCode;
  }
}

export function safeJobErrorCode(error: unknown): JobErrorCode {
  return error instanceof SafeJobHandlerError
    ? error.errorCode
    : "unexpected_error";
}
