import { z } from "zod";

const passwordHashPattern =
  /^(?:scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}|scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86})$/u;

const authEnvironmentSchema = z
  .object({
    ADMIN_EMAIL: z.string().trim().toLowerCase().email().max(254),
    ADMIN_PASSWORD_HASH: z.string().regex(passwordHashPattern),
    SESSION_SECRET: z.string().length(16).regex(/^[A-Za-z0-9]{16}$/u),
  })
  .strict();

export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;

export type AuthEnvironmentIssue = Readonly<{
  code: string;
  path: string;
}>;

export class AuthEnvironmentError extends Error {
  readonly issues: readonly AuthEnvironmentIssue[];

  constructor(issues: readonly AuthEnvironmentIssue[]) {
    super("Kimlik doğrulama ortam yapılandırması geçersiz.");
    this.name = "AuthEnvironmentError";
    this.issues = issues;
  }
}

export function parseAuthEnvironment(
  input: Record<string, string | undefined>,
): AuthEnvironment {
  const parsed = authEnvironmentSchema.safeParse(input);

  if (!parsed.success) {
    throw new AuthEnvironmentError(
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
      })),
    );
  }

  return parsed.data;
}
