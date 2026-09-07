type DevelopmentBypassEnvironment = Readonly<{
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  NODE_ENV?: string;
  PORTAL_PUSULA_ALLOW_DEV_AUTH_BYPASS?: string;
  SESSION_SECRET?: string;
}>;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function canonicalHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) return lower.slice(1, -1);
  return lower;
}

export function developmentAuthenticationBypassAllowed(
  hostname: string,
  environment: DevelopmentBypassEnvironment = process.env,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment.PORTAL_PUSULA_ALLOW_DEV_AUTH_BYPASS === "true" &&
    !environment.ADMIN_EMAIL &&
    !environment.ADMIN_PASSWORD_HASH &&
    !environment.SESSION_SECRET &&
    LOOPBACK_HOSTNAMES.has(canonicalHostname(hostname))
  );
}
