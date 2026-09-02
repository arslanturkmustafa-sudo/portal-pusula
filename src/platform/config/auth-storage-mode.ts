import "server-only";

export type AuthStorageMode = "database" | "environment";

export function getAuthStorageMode(): AuthStorageMode {
  const value = process.env.PORTAL_PUSULA_AUTH_STORAGE_MODE;
  if (value === undefined || value === "" || value === "database") {
    return "database";
  }
  if (value === "environment") return "environment";
  throw new Error("Authentication storage mode is invalid.");
}
