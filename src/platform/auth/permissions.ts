export const PERMISSION_CODES = [
  "accounts.manage",
  "customers.read",
  "customers.write",
  "customers.lifecycle",
  "customers.contact.read",
  "contracts.read",
  "contracts.write",
  "contracts.lifecycle",
  "contracts.billing.read",
  "contracts.billing.write",
  "visits.read",
  "visits.write",
  "daily-plan.read",
  "projects.read",
  "projects.write",
  "projects.lifecycle",
  "tasks.read",
  "tasks.write",
  "tasks.lifecycle",
  "tasks.assign",
  "tasks.reports.export",
  "finance.receivables.read",
  "finance.receivables.write",
  "finance.receivables.reverse",
  "finance.expenses.read",
  "finance.expenses.write",
  "finance.expenses.reverse",
  "finance.cards.read",
  "finance.cards.write",
  "finance.accounts.read",
  "finance.accounts.write",
  "finance.partnership.read",
  "finance.partnership.write",
  "finance.partnership.reverse",
  "finance.taxes.read",
  "finance.taxes.write",
  "finance.reports.read",
  "finance.reports.export",
  "audit.read",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
export type AccountRole = "member" | "owner";

export type PermissionPrincipal = Readonly<{
  permissions: readonly PermissionCode[];
  role: AccountRole;
}>;

const permissionCodeSet = new Set<string>(PERMISSION_CODES);

export class PermissionDeniedError extends Error {
  constructor() {
    super("The authenticated account does not have the required permission.");
    this.name = "PermissionDeniedError";
  }
}

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === "string" && permissionCodeSet.has(value);
}

export function hasPermission(
  principal: PermissionPrincipal,
  permission: PermissionCode,
): boolean {
  return principal.role === "owner" || principal.permissions.includes(permission);
}

export function requirePermission(
  principal: PermissionPrincipal,
  permission: PermissionCode,
): void {
  if (!hasPermission(principal, permission)) throw new PermissionDeniedError();
}
