import { z } from "zod";

const disabledValues = new Set([undefined, "", "false"]);

const exactTrimmed = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim() && !/[\r\n]/u.test(value));

const resendApiKeySchema = exactTrimmed(20, 256).regex(
  /^re_[A-Za-z0-9_-]+$/u,
);

const emailAddressSchema = exactTrimmed(3, 254).email();

export type DisabledEmailEnvironment = Readonly<{
  enabled: false;
}>;

export type EnabledEmailEnvironment = Readonly<{
  apiKey: string;
  enabled: true;
  fromAddress: string;
  fromName: string;
}>;

export type EmailEnvironment =
  | DisabledEmailEnvironment
  | EnabledEmailEnvironment;

export type EmailEnvironmentIssue = Readonly<{
  code: string;
  path: string;
}>;

export class EmailEnvironmentError extends Error {
  readonly issues: readonly EmailEnvironmentIssue[];

  constructor(issues: readonly EmailEnvironmentIssue[]) {
    super("Email environment configuration is invalid.");
    this.name = "EmailEnvironmentError";
    this.issues = issues;
  }
}

export function parseEmailEnvironment(
  input: Record<string, string | undefined>,
): EmailEnvironment {
  const enabledValue = input.EMAIL_NOTIFICATIONS_ENABLED;
  if (disabledValues.has(enabledValue)) return { enabled: false };

  if (enabledValue !== "true") {
    throw new EmailEnvironmentError([
      { code: "invalid_literal", path: "EMAIL_NOTIFICATIONS_ENABLED" },
    ]);
  }

  const parsed = z
    .object({
      EMAIL_FROM_ADDRESS: emailAddressSchema,
      EMAIL_FROM_NAME: exactTrimmed(1, 80)
        .refine((value) => !/[<>"\\]/u.test(value))
        .default("Portal Pusula"),
      RESEND_API_KEY: resendApiKeySchema,
    })
    .safeParse({
      EMAIL_FROM_ADDRESS: input.EMAIL_FROM_ADDRESS,
      EMAIL_FROM_NAME:
        input.EMAIL_FROM_NAME === undefined || input.EMAIL_FROM_NAME === ""
          ? undefined
          : input.EMAIL_FROM_NAME,
      RESEND_API_KEY: input.RESEND_API_KEY,
    });

  if (!parsed.success) {
    throw new EmailEnvironmentError(
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
      })),
    );
  }

  return {
    apiKey: parsed.data.RESEND_API_KEY,
    enabled: true,
    fromAddress: parsed.data.EMAIL_FROM_ADDRESS,
    fromName: parsed.data.EMAIL_FROM_NAME,
  };
}
