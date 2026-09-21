import type { PermissionCode } from "./permissions";

/** null means all projects; an empty list grants no project access. */
export type ProjectScope = readonly string[] | null;

export const PROJECT_SCOPED_PERMISSIONS: readonly PermissionCode[] = [
  "projects.read", "projects.write", "projects.lifecycle",
  "tasks.read", "tasks.write", "tasks.lifecycle", "tasks.reports.export",
  "customers.read", "customers.contact.read",
];

export function projectScope(principal: {
  role: string;
  projectIds?: ProjectScope;
}): ProjectScope {
  return principal.role === "owner" ? null : principal.projectIds ?? null;
}

export class ProjectAccessDeniedError extends Error {
  constructor() {
    super("Project access denied.");
    this.name = "ProjectAccessDeniedError";
  }
}

export function requireProjectAccess(scope: ProjectScope | undefined, id: string | null): void {
  if (scope != null && (id === null || !scope.includes(id))) {
    throw new ProjectAccessDeniedError();
  }
}

/** Column names are fixed application constants, never request input. */
export function projectScopeSql(column: string, scope: ProjectScope = null) {
  return scope === null
    ? { sql: "1 = 1", values: [] as string[] }
    : scope.length === 0
      ? { sql: "1 = 0", values: [] as string[] }
      : { sql: `${column} IN (${scope.map(() => "?").join(", ")})`, values: [...scope] };
}
