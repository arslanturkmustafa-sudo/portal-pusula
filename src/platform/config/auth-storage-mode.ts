import "server-only";

export type AuthStorageMode = "database" | "environment";

export function getAuthStorageMode(): AuthStorageMode {
  const value = process.env.PORTAL_PUSULA_AUTH_STORAGE_MODE;
  if (value === undefined || value === "" || value === "database") {
    return "database";
  }
  if (value === "environment") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Environment authentication mode is disabled in production.");
    }
    return "environment";
  }
  throw new Error("Authentication storage mode is invalid.");
}
