import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const nonBlankString = (maximumLength: number) =>
  z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => value.trim().length > 0);

const readinessAuthSchema = z.object({
  READINESS_BEARER_TOKEN: z
    .string()
    .length(16)
    .regex(/^[A-Za-z0-9]{16}$/u),
});

const databaseProbeSchema = z.object({
  DB_HOST: z.preprocess(
    emptyStringToUndefined,
    nonBlankString(255).default("localhost"),
  ),
  DB_PORT: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(65_535).default(3306),
  ),
  DB_NAME: nonBlankString(128),
  DB_USER: nonBlankString(128),
  DB_PASSWORD: nonBlankString(1024),
});

export type DatabaseProbeEnvironment = z.infer<typeof databaseProbeSchema>;

export type ReadinessEnvironmentIssue = {
  code: string;
  path: string;
};

export class ReadinessEnvironmentError extends Error {
  readonly issues: ReadinessEnvironmentIssue[];

  constructor(issues: ReadinessEnvironmentIssue[]) {
    super("Readiness ortam yapılandırması geçersiz.");
    this.name = "ReadinessEnvironmentError";
    this.issues = issues;
  }
}

function throwEnvironmentError(error: z.ZodError): never {
  throw new ReadinessEnvironmentError(
    error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join("."),
    })),
  );
}

export function parseReadinessBearerToken(
  value: string | undefined,
): string {
  const parsed = readinessAuthSchema.safeParse({
    READINESS_BEARER_TOKEN: value,
  });

  if (!parsed.success) {
    throwEnvironmentError(parsed.error);
  }

  return parsed.data.READINESS_BEARER_TOKEN;
}

export function parseDatabaseProbeEnvironment(
  input: Record<string, string | undefined>,
): DatabaseProbeEnvironment {
  const parsed = databaseProbeSchema.safeParse(input);

  if (!parsed.success) {
    throwEnvironmentError(parsed.error);
  }

  return parsed.data;
}
