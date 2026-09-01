import "server-only";

import {
  parseAuthEnvironment,
  type AuthEnvironment,
} from "@/platform/config/auth-env.schema";

let cachedEnvironment: AuthEnvironment | undefined;

export function getAuthEnvironment(): AuthEnvironment {
  cachedEnvironment ??= parseAuthEnvironment({
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    SESSION_SECRET: process.env.SESSION_SECRET,
  });

  return cachedEnvironment;
}
