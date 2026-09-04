import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "mysql2/promise";

import {
  type CreateCustomerInput,
  createCustomerInputSchema,
  type UpdateCustomerInput,
  updateCustomerInputSchema,
} from "@/features/customers/validation";
import {
  type Customer,
  type CustomerProjectLink,
  type CustomerProjectSummary,
  customerProjectLinkIsInUse,
  findCustomerForUpdate,
  insertCustomerProjectLink,
  insertCustomerRecord,
  listCustomerProjectLinksForUpdate,
  listCustomerRecords,
  updateCustomerProjectLinkStatus,
  updateCustomerRecord,
} from "@/features/customers/repository";
import { LifecycleArchivedRecordError } from "@/features/lifecycle";
import {
  findProjectForUpdate,
  type Project,
} from "@/features/projects/repository";
import { appendAuditEvent } from "@/platform/audit/repository";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";
import { assertCanonicalUuid } from "@/platform/validation/canonical-identifiers";

export class CustomerShortCodeConflictError extends Error {
  constructor() {
    super("Customer short code is already in use.");
    this.name = "CustomerShortCodeConflictError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor() {
    super("Customer was not found.");
    this.name = "CustomerNotFoundError";
  }
}

export class CustomerProjectNotFoundError extends Error {
  constructor() {
    super("A selected customer project was not found.");
    this.name = "CustomerProjectNotFoundError";
  }
}

export class CustomerProjectUnavailableError extends Error {
  constructor() {
    super("A selected customer project cannot accept new customer links.");
    this.name = "CustomerProjectUnavailableError";
  }
}

export class CustomerProjectVersionConflictError extends Error {
  constructor() {
    super("A customer project link was changed by another request.");
    this.name = "CustomerProjectVersionConflictError";
  }
}

export class CustomerProjectInUseError extends Error {
  constructor() {
    super("A customer project link is still used by active work.");
    this.name = "CustomerProjectInUseError";
  }
}

export class CustomerVersionConflictError extends Error {
  constructor() {
    super("Customer was changed by another request.");
    this.name = "CustomerVersionConflictError";
  }
}

export type CustomerWriteContext = Readonly<{
  actorId?: string;
  correlationId: string;
  now?: Date;
}>;

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function auditSummary(customer: Customer) {
  return {
    archivedAtUtc: customer.archivedAtUtc,
    displayName: customer.displayName,
    projectIds: customer.projects.map((project) => project.id),
    shortCode: customer.shortCode,
    status: customer.status,
    version: customer.version,
  };
}

function canAcceptNewCustomer(project: Project): boolean {
  return (
    project.archivedAtUtc === null &&
    (project.status === "active" ||
      project.status === "planned" ||
      project.status === "on_hold")
  );
}

function projectSummary(project: Project): CustomerProjectSummary {
  return {
    displayName: project.displayName,
    id: project.id,
    shortCode: project.shortCode,
    status: project.status,
  };
}

function sortedProjectSummaries(
  projects: readonly Project[],
): readonly CustomerProjectSummary[] {
  return projects
    .map(projectSummary)
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, "tr-TR") ||
        left.id.localeCompare(right.id),
    );
}

async function requireProjectsForBinding(
  connection: Parameters<typeof findProjectForUpdate>[0],
  projectIds: readonly string[],
  existingActiveProjectIds: ReadonlySet<string>,
): Promise<readonly Project[]> {
  const projects: Project[] = [];
  for (const projectId of [...projectIds].sort()) {
    const project = await findProjectForUpdate(connection, projectId);
    if (!project) throw new CustomerProjectNotFoundError();
    if (
      !existingActiveProjectIds.has(projectId) &&
      !canAcceptNewCustomer(project)
    ) {
      throw new CustomerProjectUnavailableError();
    }
    projects.push(project);
  }
  return projects;
}

async function replaceCustomerProjectLinks(
  connection: Parameters<typeof findProjectForUpdate>[0],
  customerId: string,
  projectIds: readonly string[],
  now: string,
): Promise<void> {
  const desired = new Set(projectIds);
  const links = await listCustomerProjectLinksForUpdate(connection, customerId);
  const byProjectId = new Map(links.map((link) => [link.projectId, link]));

  for (const link of links) {
    if (link.status !== "active" || desired.has(link.projectId)) continue;
    if (
      await customerProjectLinkIsInUse(
        connection,
        customerId,
        link.projectId,
      )
    ) {
      throw new CustomerProjectInUseError();
    }
    const inactive: CustomerProjectLink = {
      ...link,
      status: "inactive",
      updatedAtUtc: now,
      version: link.version + 1,
    };
    if (
      !(await updateCustomerProjectLinkStatus(
        connection,
        inactive,
        link.version,
      ))
    ) {
      throw new CustomerProjectVersionConflictError();
    }
  }

  for (const projectId of [...desired].sort()) {
    const existing = byProjectId.get(projectId);
    if (!existing) {
      await insertCustomerProjectLink(connection, {
        createdAtUtc: now,
        customerId,
        projectId,
        status: "active",
        updatedAtUtc: now,
        version: 1,
      });
      continue;
    }
    if (existing.status === "active") continue;
    const reactivated: CustomerProjectLink = {
      ...existing,
      status: "active",
      updatedAtUtc: now,
      version: existing.version + 1,
    };
    if (
      !(await updateCustomerProjectLinkStatus(
        connection,
        reactivated,
        existing.version,
      ))
    ) {
      throw new CustomerProjectVersionConflictError();
    }
  }
}

export async function listCustomers(
  pool: Pool,
  options: Readonly<{
    includeBilling?: boolean;
    includeContact?: boolean;
    includeVisits?: boolean;
  }> = {},
): Promise<readonly Customer[]> {
  return withUtcTransaction(pool, (connection) =>
    listCustomerRecords(connection, options),
  );
}

export async function createCustomer(
  pool: Pool,
  rawInput: CreateCustomerInput,
  context: CustomerWriteContext,
): Promise<Customer> {
  const input = createCustomerInputSchema.parse(rawInput);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const now = toUtcDateTime6(context.now ?? new Date());
  const { projectIds, ...customerInput } = input;
  const customer: Customer = {
    archiveReason: null,
    archivedAtUtc: null,
    archivedByUserAccountId: null,
    contactNote: customerInput.contactNote,
    createdAtUtc: now,
    displayName: customerInput.displayName,
    email: customerInput.email,
    id: randomUUID(),
    overview: { nextVisitOn: null },
    phone: customerInput.phone,
    projects: [],
    shortCode: customerInput.shortCode,
    status: customerInput.status,
    updatedAtUtc: now,
    version: 1,
  };

  try {
    return await withUtcTransaction(pool, async (connection) => {
      const projects = await requireProjectsForBinding(
        connection,
        projectIds,
        new Set(),
      );
      const persisted = {
        ...customer,
        projects: sortedProjectSummaries(projects),
      };
      await insertCustomerRecord(connection, persisted);
      await replaceCustomerProjectLinks(
        connection,
        persisted.id,
        projectIds,
        now,
      );
      await appendAuditEvent(connection, {
        action: "customer.created",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: auditSummary(persisted),
        correlationId: context.correlationId,
        entityId: persisted.id,
        entityType: "customer",
        occurredAtUtc: now,
      });
      return persisted;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new CustomerShortCodeConflictError();
    throw error;
  }
}

export async function updateCustomer(
  pool: Pool,
  id: string,
  rawInput: UpdateCustomerInput,
  context: CustomerWriteContext,
): Promise<Customer> {
  assertCanonicalUuid(id);
  if (context.actorId !== undefined) assertCanonicalUuid(context.actorId);
  const input = updateCustomerInputSchema.parse(rawInput);
  const now = toUtcDateTime6(context.now ?? new Date());

  try {
    return await withUtcTransaction(pool, async (connection) => {
      const before = await findCustomerForUpdate(connection, id);
      if (!before) throw new CustomerNotFoundError();
      if (before.archivedAtUtc !== null) {
        throw new LifecycleArchivedRecordError();
      }
      if (before.version !== input.version) {
        throw new CustomerVersionConflictError();
      }

      const { projectIds, version: expectedVersion, ...customerChanges } = input;
      let projects = before.projects;
      if (projectIds !== undefined) {
        const selectedProjects = await requireProjectsForBinding(
          connection,
          projectIds,
          new Set(before.projects.map((project) => project.id)),
        );
        projects = sortedProjectSummaries(selectedProjects);
      }

      const after: Customer = {
        ...before,
        ...customerChanges,
        projects,
        updatedAtUtc: now,
        version: before.version + 1,
      };
      if (!(await updateCustomerRecord(connection, after, expectedVersion))) {
        throw new CustomerVersionConflictError();
      }
      if (projectIds !== undefined) {
        await replaceCustomerProjectLinks(connection, id, projectIds, now);
      }
      await appendAuditEvent(connection, {
        action: "customer.updated",
        actorId: context.actorId,
        actorType: "user",
        afterSummary: auditSummary(after),
        beforeSummary: auditSummary(before),
        correlationId: context.correlationId,
        entityId: after.id,
        entityType: "customer",
        occurredAtUtc: now,
      });
      return after;
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new CustomerShortCodeConflictError();
    throw error;
  }
}
