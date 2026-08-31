import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const serverEnvSchema = z.object({
  LOG_LEVEL: z.preprocess(
    emptyStringToUndefined,
    z.enum(logLevels).default("info"),
  ),
});

export type ServerEnvironment = z.infer<typeof serverEnvSchema>;

export type EnvironmentIssue = {
  code: string;
  path: string;
};

export class ServerEnvironmentError extends Error {
  readonly issues: EnvironmentIssue[];

  constructor(issues: EnvironmentIssue[]) {
    super("Sunucu ortam yapılandırması geçersiz.");
    this.name = "ServerEnvironmentError";
    this.issues = issues;
  }
}

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  const parsed = serverEnvSchema.safeParse(input);

  if (!parsed.success) {
    throw new ServerEnvironmentError(
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
      })),
    );
  }

  return parsed.data;
}

