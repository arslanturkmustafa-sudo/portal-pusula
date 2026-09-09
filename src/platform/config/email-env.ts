import "server-only";

import {
  parseEmailEnvironment,
  type EmailEnvironment,
} from "@/platform/config/email-env.schema";

export function getEmailEnvironment(): EmailEnvironment {
  return parseEmailEnvironment({
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME,
    EMAIL_NOTIFICATIONS_ENABLED: process.env.EMAIL_NOTIFICATIONS_ENABLED,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  });
}

export function emailNotificationsEnabled(): boolean {
  try {
    return getEmailEnvironment().enabled;
  } catch {
    return false;
  }
}
