// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  EmailEnvironmentError,
  parseEmailEnvironment,
} from "@/platform/config/email-env.schema";

describe("email environment", () => {
  it("stays disabled without resolving provider configuration", () => {
    expect(
      parseEmailEnvironment({
        EMAIL_NOTIFICATIONS_ENABLED: "false",
        RESEND_API_KEY: "not-a-real-resend-api-key",
      }),
    ).toEqual({ enabled: false });
  });

  it("accepts an exact enabled Resend configuration", () => {
    expect(
      parseEmailEnvironment({
        EMAIL_FROM_ADDRESS: "bildirim@muhendiskafasi.com.tr",
        EMAIL_NOTIFICATIONS_ENABLED: "true",
        RESEND_API_KEY: `re_${"A".repeat(32)}`,
      }),
    ).toEqual({
      apiKey: `re_${"A".repeat(32)}`,
      enabled: true,
      fromAddress: "bildirim@muhendiskafasi.com.tr",
      fromName: "Portal Pusula",
    });
  });

  it("fails closed without exposing invalid values", () => {
    const credentialSentinel = "re_invalid-value-sentinel";
    let error: unknown;
    try {
      parseEmailEnvironment({
        EMAIL_FROM_ADDRESS: "bad\r\naddress@example.com",
        EMAIL_NOTIFICATIONS_ENABLED: "true",
        RESEND_API_KEY: credentialSentinel,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EmailEnvironmentError);
    expect(JSON.stringify(error)).not.toContain(credentialSentinel);
    expect(String(error)).not.toContain(credentialSentinel);
  });
});
